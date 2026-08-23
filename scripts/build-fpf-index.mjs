import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const FPF_CLUBS_URL = "https://www.fpf.pt/pt/competicoes/clubes";
const OUTPUT = path.resolve("data/fpf-clubs.json");

const browser = await chromium.launch({
  headless: true,
});

const context = await browser.newContext({
  locale: "pt-PT",
  viewport: { width: 1440, height: 1000 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
});

const page = await context.newPage();

const clubs = new Map();

function absoluteUrl(value) {
  try {
    return new URL(value, "https://www.fpf.pt").toString();
  } catch {
    return value;
  }
}

function addClub(raw) {
  if (!raw || typeof raw !== "object") return;

  const id = String(raw.Id ?? raw.id ?? "").trim();
  const name = String(
    raw.Text ?? raw.Name ?? raw.name ?? raw.Description ?? ""
  ).trim();
  const rawUrl = String(raw.Url ?? raw.url ?? "").trim();

  if (!id || !name || !rawUrl) return;

  clubs.set(id, {
    id,
    name,
    url: absoluteUrl(rawUrl),
    logoUrl: raw.logoUrl || raw.LogoUrl || undefined,
  });
}

page.on("response", async (response) => {
  const url = response.url();

  if (!/GetClubs(?:ByName)?/i.test(url)) return;

  try {
    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("json")) return;

    const data = await response.json();

    if (Array.isArray(data)) {
      for (const item of data) addClub(item);
    } else if (data && Array.isArray(data.items)) {
      for (const item of data.items) addClub(item);
    } else if (data && Array.isArray(data.data)) {
      for (const item of data.data) addClub(item);
    }
  } catch {
    // A response can disappear while the page navigates; ignore it.
  }
});

console.log(`Abrir ${FPF_CLUBS_URL}`);
await page.goto(FPF_CLUBS_URL, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});

await page.waitForTimeout(5000);

// Try to trigger the normal browser search once. The network response is
// captured above, so we do not depend on private Angular internals.
const searchInput = page.locator(
  'input[placeholder*="Nome"], input[aria-label*="Nome"], input[type="text"]'
).first();

if (await searchInput.count()) {
  await searchInput.fill("Sporting CP");
  const button = page.getByRole("button", { name: /Pesquisar/i }).first();

  if (await button.count()) {
    await button.click();
    await page.waitForTimeout(3000);
  }
}

// Also collect any club cards already rendered by the page.
async function collectRenderedClubs() {
  const rows = await page.locator('a[href*="/Clubes/Detalhe-de-clube/Club/"]').evaluateAll(
    (anchors) =>
      anchors.map((a) => {
        const href = a.getAttribute("href") || "";
        const img = a.querySelector("img");
        return {
          name: (a.textContent || "").replace(/\s+/g, " ").trim(),
          url: href,
          logoUrl:
            img?.getAttribute("src") ||
            img?.getAttribute("data-src") ||
            img?.getAttribute("data-src2x") ||
            undefined,
        };
      })
  );

  for (const row of rows) {
    const match = row.url.match(/\/Club\/(\d+)/i) || row.url.match(/\/Club\/es\/Detalhe-de-clube\/Club\/(\d+)/i);
    const id = match?.[1];

    if (!id || !row.name) continue;

    clubs.set(id, {
      id,
      name: row.name,
      url: absoluteUrl(row.url),
      logoUrl: row.logoUrl
        ? absoluteUrl(row.logoUrl)
        : `https://imagehandler.fpf.pt/ScoreImageHandler.ashx?type=Organization&id=${id}`,
    });
  }
}

await collectRenderedClubs();

console.log(`Clubes recolhidos: ${clubs.size}`);

if (clubs.size < 20) {
  console.error(
    "A FPF não devolveu clubes suficientes. O índice não será gravado."
  );
  await browser.close();
  process.exit(1);
}

const output = {
  updatedAt: new Date().toISOString(),
  source: FPF_CLUBS_URL,
  clubs: [...clubs.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-PT")
  ),
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + "\n");

console.log(`Índice gravado em ${OUTPUT}: ${output.clubs.length} clubes.`);

await browser.close();
