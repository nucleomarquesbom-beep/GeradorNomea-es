type Club = {
  id: string;
  name: string;
  url: string;
  logoUrl?: string;
};

type ResolveResult = {
  status: "found" | "ambiguous" | "not_found" | "error";
  club?: Club;
  candidates?: Club[];
  message?: string;
};

const FPF_RESULTS_ORIGIN = "https://resultados.fpf.pt";
const FPF_CLUBS_INDEX = `${FPF_RESULTS_ORIGIN}/Club`;
const CACHE_MS = Number(process.env.FPF_CACHE_SECONDS || 21600) * 1000;

let directoryCache:
  | { expires: number; clubs: Club[] }
  | null = null;

function cleanHtmlText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value: string): string {
  return new URL(value, FPF_RESULTS_ORIGIN).toString();
}

async function getHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 FPF-Escudos/2.0",
      "Accept": "text/html,application/xhtml+xml",
    },
    next: { revalidate: 21600 },
  });

  if (!response.ok) {
    throw new Error(`FPF HTTP ${response.status}: ${url}`);
  }

  return response.text();
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[“”"]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreName(query: string, candidate: string): number {
  const q = normalizeForMatch(query);
  const c = normalizeForMatch(candidate);

  if (!q || !c) return 0;
  if (q === c) return 1000;

  const qTokens = q.split(" ");
  const cTokens = c.split(" ");
  const cSet = new Set(cTokens);

  const common = qTokens.filter((token) => cSet.has(token));
  const coverage = common.length / qTokens.length;

  if (c.includes(q)) return 850 + Math.round(coverage * 50);
  if (q.includes(c)) return 800 + Math.round(coverage * 50);

  return Math.round(coverage * 700);
}

function extractAssociations(html: string): string[] {
  const ids = new Set<string>();
  const re = /href=["'](?:https?:\/\/resultados\.fpf\.pt)?\/Club\/Club\?associationId=(\d+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html))) {
    ids.add(match[1]);
  }

  return [...ids];
}

function extractClubsFromAssociationPage(html: string): Club[] {
  const clubs: Club[] = [];
  const seen = new Set<string>();

  const re =
    /<a[^>]+href=["'](?:https?:\/\/resultados\.fpf\.pt)?\/Club\/Details\?clubId=(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;

  while ((match = re.exec(html))) {
    const id = match[1];
    const name = cleanHtmlText(match[2]);

    if (!name || name.length < 2) continue;
    if (seen.has(id)) continue;

    seen.add(id);
    clubs.push({
      id,
      name,
      url: `${FPF_RESULTS_ORIGIN}/Club/Details?clubId=${id}`,
    });
  }

  return clubs;
}

function extractLogoFromClubPage(html: string, clubId: string): string | undefined {
  // Prefer an image whose alt/title contains the club name.
  const imageRe =
    /<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*(?:alt|title)=["']([^"']+)["'][^>]*>/gi;

  let match: RegExpExecArray | null;
  while ((match = imageRe.exec(html))) {
    const src = match[1];
    const label = cleanHtmlText(match[2]);

    if (
      label &&
      !/google play|app store/i.test(label) &&
      /\.(png|jpe?g|webp|svg)(\?|$)/i.test(src)
    ) {
      return absoluteUrl(src);
    }
  }

  // Also support alt/title appearing before src.
  const imageRe2 =
    /<img[^>]+(?:alt|title)=["']([^"']+)["'][^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;

  while ((match = imageRe2.exec(html))) {
    const label = cleanHtmlText(match[1]);
    const src = match[2];

    if (
      label &&
      !/google play|app store/i.test(label) &&
      /\.(png|jpe?g|webp|svg)(\?|$)/i.test(src)
    ) {
      return absoluteUrl(src);
    }
  }

  // Official FPF image-handler fallback. It is only used if the official
  // results page does not expose the image URL in its HTML.
  return `https://fpfimagehandler.fpf.pt/FPFImageHandler.ashx?type=Club&id=${encodeURIComponent(clubId)}`;
}

async function enrichClub(club: Club): Promise<Club> {
  try {
    const html = await getHtml(club.url);
    const logoUrl = extractLogoFromClubPage(html, club.id);
    return logoUrl ? { ...club, logoUrl } : club;
  } catch {
    return {
      ...club,
      logoUrl:
        `https://fpfimagehandler.fpf.pt/FPFImageHandler.ashx?type=Club&id=${encodeURIComponent(club.id)}`,
    };
  }
}

async function loadDirectory(): Promise<Club[]> {
  if (directoryCache && Date.now() < directoryCache.expires) {
    return directoryCache.clubs;
  }

  const indexHtml = await getHtml(FPF_CLUBS_INDEX);
  const associationIds = extractAssociations(indexHtml);

  if (!associationIds.length) {
    throw new Error("A FPF não devolveu as associações do diretório.");
  }

  const pages = await Promise.all(
    associationIds.map(async (id) => {
      try {
        return await getHtml(
          `${FPF_RESULTS_ORIGIN}/Club/Club?associationId=${id}`
        );
      } catch (error) {
        console.warn("Falha numa associação FPF", id, error);
        return "";
      }
    })
  );

  const map = new Map<string, Club>();

  for (const html of pages) {
    for (const club of extractClubsFromAssociationPage(html)) {
      map.set(club.id, club);
    }
  }

  const clubs = [...map.values()];
  directoryCache = {
    expires: Date.now() + CACHE_MS,
    clubs,
  };

  return clubs;
}

export async function resolveClub(query: string): Promise<ResolveResult> {
  try {
    const clubs = await loadDirectory();

    if (!clubs.length) {
      return {
        status: "not_found",
        message: "A lista de clubes da FPF veio vazia.",
      };
    }

    const ranked = clubs
      .map((club) => ({ club, score: scoreName(query, club.name) }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];

    if (!best || best.score < 350) {
      return { status: "not_found" };
    }

    const close = ranked
      .filter((item) => item.score >= best.score - 50)
      .slice(0, 5)
      .map((item) => item.club);

    if (
      close.length > 1 &&
      scoreName(query, close[1].name) >= best.score - 25
    ) {
      return {
        status: "ambiguous",
        candidates: close,
      };
    }

    const club = await enrichClub(best.club);

    return {
      status: "found",
      club,
    };
  } catch (error) {
    console.error("FPF resolver error:", error);

    return {
      status: "error",
      message:
        "Não foi possível consultar o diretório oficial de clubes da FPF neste momento.",
    };
  }
}
