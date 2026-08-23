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

const FPF_CLUBS_PAGE = "https://www.fpf.pt/pt/competicoes/clubes";
const FPF_SEARCH_URL =
  "https://www.fpf.pt/DesktopModules/MVC/SearchClubs/Default/GetClubsByName";
const FPF_SITE_ORIGIN = "https://www.fpf.pt";
const FPF_IMAGE_ORIGIN = "https://imagehandler.fpf.pt";

let sessionPromise: Promise<string> | null = null;

function cookieHeader(setCookie: string | null): string {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=\s*[^;,=]+=[^;,]+)/g)
    .map((part) => part.split(";", 1)[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function getFpfSessionCookie(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const response = await fetch(FPF_CLUBS_PAGE, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`FPF Clubs page HTTP ${response.status}`);
      }

      return cookieHeader(response.headers.get("set-cookie"));
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }

  return sessionPromise;
}

function absoluteUrl(value: string): string {
  return new URL(value, FPF_SITE_ORIGIN).toString();
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
  const cSet = new Set(c.split(" "));
  const common = qTokens.filter((token) => cSet.has(token));
  const coverage = common.length / qTokens.length;
  if (c.includes(q)) return 850 + Math.round(coverage * 50);
  if (q.includes(c)) return 800 + Math.round(coverage * 50);
  return Math.round(coverage * 700);
}

async function fetchSearch(searchText: string, retry = 0): Promise<Response> {
  const cookie = await getFpfSessionCookie();

  const response = await fetch(FPF_SEARCH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: FPF_SITE_ORIGIN,
      Referer: FPF_CLUBS_PAGE,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ searchText }),
    cache: "no-store",
  });

  // FPF can occasionally reject a cold/session-less request. Refresh the
  // session once, then retry. We never silently replace the FPF source.
  if ((response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500) && retry < 2) {
    sessionPromise = null;
    await new Promise((resolve) => setTimeout(resolve, 350 * (retry + 1)));
    return fetchSearch(searchText, retry + 1);
  }

  return response;
}

async function searchFpfByName(searchText: string): Promise<Club[]> {
  const response = await fetchSearch(searchText);

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`FPF GetClubsByName HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Resposta inesperada do GetClubsByName da FPF.");
  }

  return data
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = String(row.Id ?? "").trim();
      const name = String(row.Text ?? "").trim();
      const rawUrl = String(row.Url ?? "").trim();
      if (!id || !name || !rawUrl) return null;
      return { id, name, url: absoluteUrl(rawUrl) } satisfies Club;
    })
    .filter((club): club is Club => club !== null);
}

async function getClubPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: FPF_CLUBS_PAGE,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`FPF club page HTTP ${response.status}: ${url}`);
  return response.text();
}

function extractFpfOrganizationLogo(html: string): string | undefined {
  const decoded = html
    .replace(/&amp;/gi, "&")
    .replace(/\\\//g, "/");

  // Accept the real URL regardless of query parameter order. The page may
  // contain src, data-src or data-src2x depending on viewport.
  const urls = decoded.match(/https?:\/\/imagehandler\.fpf\.pt\/ScoreImageHandler\.ashx\?[^\"'< >]+/gi) ?? [];
  for (const raw of urls) {
    try {
      const u = new URL(raw);
      if (u.searchParams.get("type")?.toLowerCase() !== "organization") continue;
      const id = u.searchParams.get("id");
      if (!id) continue;
      return `${FPF_IMAGE_ORIGIN}/ScoreImageHandler.ashx?type=Organization&id=${encodeURIComponent(id)}`;
    } catch {
      // continue
    }
  }

  // Some pages use a relative URL.
  const relative = decoded.match(/(?:src|data-src|data-src2x)=[\"']([^\"']*ScoreImageHandler\.ashx\?[^\"']*)[\"']/i);
  if (relative?.[1]) {
    try {
      const u = new URL(relative[1], FPF_IMAGE_ORIGIN);
      if (u.searchParams.get("type")?.toLowerCase() === "organization" && u.searchParams.get("id")) {
        return `${FPF_IMAGE_ORIGIN}/ScoreImageHandler.ashx?type=Organization&id=${encodeURIComponent(u.searchParams.get("id")!)}`;
      }
    } catch {}
  }

  return undefined;
}

async function enrichClub(club: Club): Promise<Club> {
  const html = await getClubPage(club.url);
  const logoUrl = extractFpfOrganizationLogo(html);
  return logoUrl ? { ...club, logoUrl } : club;
}

export async function resolveClub(query: string): Promise<ResolveResult> {
  try {
    const clubs = await searchFpfByName(query);
    if (!clubs.length) {
      return { status: "not_found", message: `A FPF não encontrou nenhum clube para "${query}".` };
    }

    const ranked = clubs
      .map((club) => ({ club, score: scoreName(query, club.name) }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < 350) {
      return { status: "not_found", message: `A FPF devolveu resultados, mas nenhum corresponde suficientemente a "${query}".` };
    }

    const second = ranked[1];
    const close = ranked
      .filter((item) => item.score >= best.score - 50)
      .slice(0, 5)
      .map((item) => item.club);

    if (second && second.score >= best.score - 25) {
      return { status: "ambiguous", candidates: close, message: "A FPF devolveu mais do que uma correspondência próxima." };
    }

    try {
      return { status: "found", club: await enrichClub(best.club) };
    } catch (error) {
      console.warn("FPF club detail page unavailable", best.club.url, error);
      return { status: "found", club: best.club, message: "Clube encontrado na FPF, mas não foi possível obter o escudo agora." };
    }
  } catch (error) {
    console.error("FPF resolver error:", error);
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Não foi possível consultar a pesquisa oficial de clubes da FPF neste momento.",
    };
  }
}
