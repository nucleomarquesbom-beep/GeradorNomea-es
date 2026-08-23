import pdfParse from "pdf-parse";

const STOP_WORDS = new Set([
  "JOGO", "ÁRBITRO", "ASSOCIAÇÃO", "NOTA", "INFORMATIVA",
  "DATA", "OBS", "OBSV", "VAR", "AVAR"
]);

/**
 * O PDF da FPF tem três colunas fixas: Jogo, Árbitro e Associação.
 * Reconstruímos essas colunas pela posição X dos elementos PDF.
 */
async function renderPage(pageData: any): Promise<string> {
  const content = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });

  const rows: { y: number; items: any[] }[] = [];

  for (const item of content.items) {
    if (!item || typeof item.str !== "string" || !item.str.trim()) continue;

    const x = Number(item.transform?.[4] ?? 0);
    const y = Number(item.transform?.[5] ?? 0);

    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ ...item, x });
  }

  rows.sort((a, b) => b.y - a.y);

  return rows.map((row) => {
    const game = row.items
      .filter((item) => item.x < 295)
      .sort((a, b) => a.x - b.x)
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const referee = row.items
      .filter((item) => item.x >= 295 && item.x < 465)
      .sort((a, b) => a.x - b.x)
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const association = row.items
      .filter((item) => item.x >= 465)
      .sort((a, b) => a.x - b.x)
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return `${game}\t${referee}\t${association}`;
  }).join("\n");
}

export function normalizeTeamName(value: string): string {
  let s = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Remove B only when it is a standalone final marker.
  s = s.replace(/\s+B\s*$/i, "").trim();

  // Remove company/team suffixes only at the end.
  // OAF can occur as /OAF.
  let changed = true;
  while (changed) {
    const before = s;
    s = s.replace(
      /(?:\s+|\/)(?:SAD|SDUQ|SDQ|SUQ|OAF)\s*$/i,
      ""
    ).trim();
    s = s.replace(/\s+B\s*$/i, "").trim();
    changed = s !== before;
  }

  return s.replace(/\s{2,}/g, " ").trim();
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

export function extractTeamsFromPdf(text: string): string[] {
  const rawLines = text.split(/\r?\n/);
  const games: string[] = [];
  let currentGame = "";

  for (const raw of rawLines) {
    const line = raw.trimEnd();
    const [gameRaw = "", refereeRaw = "", associationRaw = ""] = line.split("\t");
    const game = cleanLine(gameRaw);
    const referee = cleanLine(refereeRaw);
    const association = cleanLine(associationRaw);

    if (game && association.toUpperCase().startsWith("A.F.")) {
      if (game.includes(" - ")) {
        currentGame = game;
        games.push(currentGame);
      }
      continue;
    }

    // Long club names occasionally wrap inside the Jogo column.
    // Example:
    //   CLUBE ... ÁGUIAS UNIDAS - CLC PISCINAS
    //   LDA - SONÂMBULOS FLA
    if (game && !referee && currentGame && !association) {
      currentGame = `${currentGame} ${game}`.replace(/\s+/g, " ").trim();
      games[games.length - 1] = currentGame;
    }
  }

  const found: string[] = [];

  for (const game of games) {
    const separator = game.indexOf(" - ");
    if (separator < 0) continue;

    const a = cleanLine(game.slice(0, separator));
    const b = cleanLine(game.slice(separator + 3));

    for (const team of [a, b]) {
      const normalized = normalizeTeamName(team);
      if (normalized.length < 3) continue;
      if (STOP_WORDS.has(normalized.toUpperCase())) continue;
      found.push(team);
    }
  }

  return [...new Map(
    found.map((team) => [normalizeTeamName(team).toUpperCase(), team])
  ).values()];
}

export async function parseFpfPdf(buffer: Buffer) {
  return pdfParse(buffer, { pagerender: renderPage });
}
