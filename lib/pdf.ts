const STOP_WORDS = new Set([
  "JOGO", "ÁRBITRO", "ASSOCIAÇÃO", "NOTA", "INFORMATIVA",
  "DATA", "OBS", "OBSV", "VAR", "AVAR"
]);

export function normalizeTeamName(value: string): string {
  let s = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Remove identifiers only when they occur as standalone suffixes.
  // Deliberately do NOT remove OAF globally: it can be part of a real
  // club name. The suffix rule handles "ACADÉMICA COIMBRA/OAF SDUQ".
  s = s.replace(
    /(?:\s+|\/)(?:SAD|SDUQ|SDQ|SUQ|OAF)\s*$/i,
    ""
  );

  // Team B / reserve-team notation: only standalone B at the end,
  // optionally quoted and after a legal-company suffix.
  s = s.replace(/\s+(?:"?B"?)(?:\s*)$/i, "");

  // A second pass handles "SAD B" / "SAD \"B\"".
  s = s.replace(
    /\s+(?:SAD|SDUQ|SDQ|SUQ|OAF)\s*(?:"?B"?)\s*$/i,
    ""
  );

  return s.replace(/\s{2,}/g, " ").trim();
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

export function extractTeamsFromPdf(text: string): string[] {
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const found: string[] = [];

  for (const line of lines) {
    if (!line.includes(" - ")) continue;
    if (line.length > 180) continue;

    const [left, ...rest] = line.split(" - ");
    const rightAndOfficials = rest.join(" - ");

    if (!left || !rightAndOfficials) continue;

    // In the FPF nomination PDFs the officials follow the second team.
    // Keep the text before the first obvious official-association marker.
    const right = rightAndOfficials
      .split(/\s+(?=[A-ZÁÉÍÓÚÀÃÕÇ][A-ZÁÉÍÓÚÀÃÕÇ .'-]+\s+A\.F\.)/)[0]
      .trim();

    const a = left.trim();
    const b = right.trim();

    if (!a || !b) continue;
    if (STOP_WORDS.has(a.toUpperCase())) continue;
    if (/^(VENC|VENCEDOR)\s+JOGO/i.test(a)) continue;

    for (const team of [a, b]) {
      const normalized = normalizeTeamName(team);
      if (normalized.length >= 3 && !STOP_WORDS.has(normalized.toUpperCase())) {
        found.push(team);
      }
    }
  }

  return [...new Map(
    found.map(team => [normalizeTeamName(team).toUpperCase(), team])
  ).values()];
}