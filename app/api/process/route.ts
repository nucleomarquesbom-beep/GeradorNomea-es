import { NextResponse } from "next/server";
import { extractTeamsFromPdf, normalizeTeamName, parseFpfPdf } from "../../../lib/pdf";
import { resolveClub } from "../../../lib/fpf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "É necessário enviar um PDF." },
        { status: 400 }
      );
    }

    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      return NextResponse.json(
        { error: "O ficheiro tem de ser PDF." },
        { status: 400 }
      );
    }

    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json(
        { error: "O PDF não pode ultrapassar 15 MB." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseFpfPdf(buffer);
    const teams = extractTeamsFromPdf(parsed.text);

    const results = [];

    // Resolve in parallel, but keep one result per unique team.
    const resolved = await Promise.all(
      teams.map(async (original) => {
        const normalized = normalizeTeamName(original);
        const result = await resolveClub(normalized);
        return { original, normalized, ...result };
      })
    );

    results.push(...resolved);

    return NextResponse.json({
      ok: true,
      pages: parsed.numpages,
      teamCount: results.length,
      results,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          "Não foi possível ler o PDF. Confirma que é um PDF de texto da FPF.",
      },
      { status: 500 }
    );
  }
}
