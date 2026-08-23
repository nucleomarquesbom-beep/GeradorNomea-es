import fs from "node:fs";
import path from "node:path";

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

type FpfIndex = {
  updatedAt?: string;
  clubs: Club[];
};

function loadIndex(): FpfIndex {
  const file = path.join(process.cwd(), "data", "fpf-clubs.json");

  if (!fs.existsSync(file)) {
    throw new Error(
      "O índice de clubes da FPF ainda não foi criado. Executa a ação GitHub 'Atualizar índice FPF'."
    );
  }

  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw) as FpfIndex;

  if (!Array.isArray(data.clubs)) {
    throw new Error("O índice de clubes da FPF está inválido.");
  }

  return data;
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

function tokens(value: string): string[] {
  return normalizeForMatch(value).split(" ").filter(Boolean);
}

function scoreName(query: string, candidate: string): number {
  const q = normalizeForMatch(query);
  const c = normalizeForMatch(candidate);

  if (!q || !c) return 0;
  if (q === c) return 1000;

  const qTokens = tokens(query);
  const cTokens = new Set(tokens(candidate));
  const common = qTokens.filter((token) => cTokens.has(token));
  const coverage = common.length / Math.max(qTokens.length, 1);

  if (c.includes(q)) return 900 + Math.round(coverage * 50);
  if (q.includes(c)) return 850 + Math.round(coverage * 50);

  return Math.round(coverage * 700);
}

export async function resolveClub(query: string): Promise<ResolveResult> {
  try {
    const index = loadIndex();

    const ranked = index.clubs
      .map((club) => ({
        club,
        score: scoreName(query, club.name),
      }))
      .filter((item) => item.score >= 350)
      .sort((a, b) => b.score - a.score);

    if (!ranked.length) {
      return {
        status: "not_found",
        message: `A FPF não encontrou nenhum clube para "${query}".`,
      };
    }

    const best = ranked[0];
    const second = ranked[1];

    if (second && second.score >= best.score - 25) {
      return {
        status: "ambiguous",
        candidates: ranked.slice(0, 5).map((item) => item.club),
        message: "A FPF devolveu mais do que uma correspondência próxima.",
      };
    }

    return {
      status: "found",
      club: best.club,
      message: index.updatedAt
        ? `Clube encontrado no índice oficial da FPF, atualizado em ${new Date(index.updatedAt).toLocaleDateString("pt-PT")}.`
        : undefined,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Não foi possível consultar o índice oficial da FPF.",
    };
  }
}
