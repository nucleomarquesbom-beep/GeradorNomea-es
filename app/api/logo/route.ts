import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const source = url.searchParams.get("url");

  if (!source) {
    return new NextResponse("Missing url", { status: 400 });
  }

  let target: URL;

  try {
    target = new URL(source);
  } catch {
    return new NextResponse("Invalid url", { status: 400 });
  }

  const allowedHosts = new Set([
    "resultados.fpf.pt",
    "www.fpf.pt",
    "fpfimagehandler.fpf.pt",
    "imagehandler.fpf.pt",
  ]);

  if (!allowedHosts.has(target.hostname)) {
    return new NextResponse("Source not allowed", { status: 403 });
  }

  try {
    const response = await fetch(target.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 FPF-Escudos/2.0",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      next: { revalidate: 21600 },
    });

    if (!response.ok) {
      return new NextResponse("Logo not available", { status: response.status });
    }

    const contentType =
      response.headers.get("content-type") || "image/png";
    const body = await response.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=21600, s-maxage=21600",
      },
    });
  } catch {
    return new NextResponse("Logo request failed", { status: 502 });
  }
}
