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

    const results = new Array(teams.length);
    const concurrency = 4;
    let nextIndex = 0;

    async function worker() {
      while (true) {
        const index = nextIndex++;
        if (index >= teams.length) return;

        const original = teams[index];
        const normalized = normalizeTeamName(original);
        const result = await resolveClub(normalized);

        results[index] = {
          original,
          normalized,
          ...result,
        };
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, teams.length) },
        () => worker()
      )
    );

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
          error instanceof Error
            ? error.message
            : "Não foi possível processar o PDF.",
      },
      { status: 500 }
    );
  }
}
