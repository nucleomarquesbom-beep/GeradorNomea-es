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

// This is the same endpoint used by the FPF Clubs page when a human types
// a name in "Nome da Equipa" and presses "Pesquisar".
const FPF_SEARCH_URL =
  "https://www.fpf.pt/DesktopModules/MVC/SearchClubs/Default/GetClubsByName";
const FPF_SITE_ORIGIN = "https://www.fpf.pt";
const FPF_IMAGE_ORIGIN = "https://imagehandler.fpf.pt";

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

async function searchFpfByName(searchText: string): Promise<Club[]> {
  const response = await fetch(FPF_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${FPF_SITE_ORIGIN}/pt/competicoes/clubes`,
      Origin: FPF_SITE_ORIGIN,
      "User-Agent": "Mozilla/5.0 FPF-Escudos",
    },
    body: JSON.stringify({ searchText }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`FPF GetClubsByName HTTP ${response.status}`);
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

      return {
        id,
        name,
        url: absoluteUrl(rawUrl),
      } satisfies Club;
    })
    .filter((club): club is Club => club !== null);
}

async function getClubPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: `${FPF_SITE_ORIGIN}/pt/competicoes/clubes`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`FPF club page HTTP ${response.status}: ${url}`);
  }

  return response.text();
}

function extractFpfOrganizationLogo(html: string): string | undefined {
  // The club page renders the official crest through:
  // https://imagehandler.fpf.pt/ScoreImageHandler.ashx?type=Organization&id=XXXX
  // It may occur in src, data-src or HTML-encoded attributes.
  const decoded = html.replace(/&amp;/gi, "&");
  const re = /(?:https?:)?\/\/imagehandler\.fpf\.pt\/ScoreImageHandler\.ashx\?[^"'<>\s]*type=Organization[^"'<>\s]*id=(\d+)[^"'<>\s]*/i;
  const match = decoded.match(re);

  if (!match) return undefined;

  const id = match[1];
  return `${FPF_IMAGE_ORIGIN}/ScoreImageHandler.ashx?type=Organization&id=${encodeURIComponent(id)}`;
}

async function enrichClub(club: Club): Promise<Club> {
  const html = await getClubPage(club.url);
  const logoUrl = extractFpfOrganizationLogo(html);

  return logoUrl ? { ...club, logoUrl } : club;
}

export async function resolveClub(query: string): Promise<ResolveResult> {
  try {
    // This intentionally mirrors the human workflow on fpf.pt:
    // write the team name in "Nome da Equipa" and press "Pesquisar".
    const clubs = await searchFpfByName(query);

    if (!clubs.length) {
      return {
        status: "not_found",
        message: `A FPF não encontrou nenhum clube para "${query}".`,
      };
    }

    const ranked = clubs
      .map((club) => ({ club, score: scoreName(query, club.name) }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < 350) {
      return {
        status: "not_found",
        message: `A FPF devolveu resultados, mas nenhum corresponde suficientemente a "${query}".`,
      };
    }

    const second = ranked[1];
    const close = ranked
      .filter((item) => item.score >= best.score - 50)
      .slice(0, 5)
      .map((item) => item.club);

    if (second && second.score >= best.score - 25) {
      return {
        status: "ambiguous",
        candidates: close,
        message: "A FPF devolveu mais do que uma correspondência próxima.",
      };
    }

    try {
      const club = await enrichClub(best.club);
      return { status: "found", club };
    } catch (error) {
      // The club itself was found by the official FPF search. If the detail
      // page is temporarily unavailable, keep that result rather than
      // inventing an image URL.
      console.warn("FPF club detail page unavailable", best.club.url, error);
      return {
        status: "found",
        club: best.club,
        message: "Clube encontrado na FPF, mas não foi possível obter o escudo agora.",
      };
    }
  } catch (error) {
    console.error("FPF resolver error:", error);
    return {
      status: "error",
      message:
        "Não foi possível consultar a pesquisa oficial de clubes da FPF neste momento.",
    };
  }
}
