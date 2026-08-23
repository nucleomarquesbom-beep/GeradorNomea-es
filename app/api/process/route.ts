import { NextResponse } from "next";
import pdfParse from "pdf-parse";
import { extractTeamsFromPdf, normalizeTeamName } from "../../../lib/pdf";
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
    const parsed = await pdfParse(buffer);

    const teams = extractTeamsFromPdf(parsed.text);

    const results = [];

    for (const original of teams) {
      const normalized = normalizeTeamName(original);
      const resolved = await resolveClub(normalized);

      results.push({
        original,
        normalized,
        ...resolved,
      });
    }

    return NextResponse.json({
      ok: true,
      pages: parsed.numpages,
      results,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          "Não foi possível ler o PDF. Confirma que é um PDF com texto selecionável.",
      },
      { status: 500 }
    );
  }
}
