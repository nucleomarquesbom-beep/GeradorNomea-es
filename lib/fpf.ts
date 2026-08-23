type Club = {
  id?: string;
  name: string;
  url?: string;
  logoUrl?: string;
};

type ResolveResult = {
  status: "found" | "ambiguous" | "not_found" | "error";
  club?: Club;
  candidates?: Club[];
  message?: string;
};

const FPF_CLUBS_PAGE = "https://www.fpf.pt/pt/competicoes/clubes";
const FPF_ORIGIN = "https://www.fpf.pt";

function scoreName(query: string, candidate: string): number {
  const q = query.toUpperCase();
  const c = candidate.toUpperCase();

  if (q === c) return 100;
  if (c.includes(q)) return 88;
  if (q.includes(c)) return 82;

  const qTokens = new Set(q.split(/[^A-Z0-9]+/).filter(Boolean));
  const cTokens = new Set(c.split(/[^A-Z0-9]+/).filter(Boolean));
  const overlap = [...qTokens].filter(x => cTokens.has(x)).length;

  return overlap * 10;
}

function absoluteUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, FPF_ORIGIN).toString();
  } catch {
    return undefined;
  }
}

function extractClubsFromHtml(html: string): Club[] {
  const clubs: Club[] = [];
  const seen = new Set<string>();

  // Handles common FPF-rendered club/detail links and image tags.
  const linkRe = /<a[^>]+href=["']([^"']*\/(?:Clubes|Club)\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRe.exec(html))) {
    const url = absoluteUrl(match[1]);
    const text = match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!text || text.length < 2) continue;

    const key = `${text.toUpperCase()}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const id = url?.match(/(?:Club|club)[/=-](\d+)/)?.[1];
    clubs.push({ id, name: text, url });
  }

  // Some FPF pages expose club data as JSON-like objects.
  const jsonRe = /["'](?:Name|name)["']\s*:\s*["']([^"']+)["'][\s\S]{0,800}?["'](?:Id|id)["']\s*:\s*["']?(\d+)/g;
  while ((match = jsonRe.exec(html))) {
    const name = match[1].trim();
    const id = match[2];
    const key = `${name.toUpperCase()}|${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clubs.push({
      id,
      name,
      url: `${FPF_ORIGIN}/pt/Clubes/Detalhe-de-clube/Club/${id}`
    });
  }

  return clubs;
}

async function fetchFpfSearch(query: string): Promise<Club[]> {
  const endpoint = process.env.FPF_CLUB_SEARCH_ENDPOINT?.trim();

  if (endpoint) {
    const url = new URL(endpoint);
    url.searchParams.set("q", query);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 FPF-Escudos/1.0",
        "Accept": "application/json,text/html;q=0.9,*/*;q=0.8"
      },
      cache: "no-store"
    });

    if (!response.ok) throw new Error(`FPF search HTTP ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      return Array.isArray(data)
        ? data.map((x: any) => ({
            id: x.id ?? x.Id,
            name: x.name ?? x.Name ?? x.clubName ?? x.ClubName,
            url: absoluteUrl(x.url ?? x.Url),
            logoUrl: absoluteUrl(x.logoUrl ?? x.LogoUrl ?? x.logo)
          })).filter((x: Club) => Boolean(x.name))
        : [];
    }

    return extractClubsFromHtml(await response.text());
  }

  const response = await fetch(FPF_CLUBS_PAGE, {
    headers: {
      "User-Agent": "Mozilla/5.0 FPF-Escudos/1.0",
      "Accept": "text/html,application/xhtml+xml"
    },
    cache: "no-store"
  });

  if (!response.ok) throw new Error(`FPF clubs page HTTP ${response.status}`);
  return extractClubsFromHtml(await response.text());
}

export async function resolveClub(query: string): Promise<ResolveResult> {
  try {
    const clubs = await fetchFpfSearch(query);

    if (!clubs.length) {
      return {
        status: "not_found",
        message:
          "A página pública da FPF não devolveu dados de clubes para esta pesquisa."
      };
    }

    const ranked = clubs
      .map(club => ({ club, score: scoreName(query, club.name) }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < 35) {
      return { status: "not_found" };
    }

    const close = ranked
      .filter(x => x.score >= best.score - 8)
      .slice(0, 5)
      .map(x => x.club);

    if (close.length > 1 && close[0].name.toUpperCase() !== query.toUpperCase()) {
      return {
        status: "ambiguous",
        candidates: close
      };
    }

    return {
      status: "found",
      club: best.club
    };
  } catch (error) {
    console.error("FPF resolver error:", error);
    return {
      status: "error",
      message:
        "A FPF recusou ou não disponibilizou a pesquisa neste momento."
    };
  }
}