import { NextResponse } from "next/server";

const ALLOWED_HOSTS = new Set([
  "imagehandler.fpf.pt",
  "www.fpf.pt",
  "fpf.pt"
]);

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "URL em falta." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return NextResponse.json({ error: "URL inválido." }, { status: 400 });
  }

  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return NextResponse.json({ error: "Domínio não permitido." }, { status: 403 });
  }

  const response = await fetch(target, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Imagem FPF HTTP ${response.status}.` },
      { status: response.status }
    );
  }

  return new NextResponse(response.body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("content-type") || "image/png",
      "Cache-Control": "public, max-age=86400"
    }
  });
}
