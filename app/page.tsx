"use client";

import { ChangeEvent, useState } from "react";

type Result = {
  original: string;
  normalized: string;
  status: "found" | "ambiguous" | "not_found" | "error";
  club?: { id: string; name: string; url: string; logoUrl?: string };
  candidates?: { id: string; name: string; url: string; logoUrl?: string }[];
  message?: string;
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function processPdf() {
    if (!file) return;

    setLoading(true);
    setMessage("");
    setResults([]);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch("/api/process", {
        method: "POST",
        body,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Não foi possível processar o PDF.");
      }

      setResults(data.results || []);
      setMessage(`Foram identificadas ${data.teamCount ?? 0} equipas.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Erro inesperado."
      );
    } finally {
      setLoading(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setResults([]);
    setMessage("");
  }

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">FPF • CLUBES</span>
        <h1>Escudos das equipas</h1>
        <p>
          Carrega uma nomeação em PDF. A aplicação lê apenas os jogos,
          identifica as equipas e pesquisa cada equipa diretamente no campo "Nome da Equipa" da FPF e usa a página oficial do clube para obter o escudo.
        </p>
      </section>

      <section className="card upload-card">
        <label className="dropzone">
          <input type="file" accept="application/pdf,.pdf" onChange={onFileChange} />
          <span className="upload-icon">↑</span>
          <strong>{file ? file.name : "Escolher PDF"}</strong>
          <small>PDF de nomeações da FPF</small>
        </label>

        <button
          className="primary"
          disabled={!file || loading}
          onClick={processPdf}
        >
          {loading ? "A ler PDF e a consultar a FPF…" : "Ler PDF e procurar escudos"}
        </button>

        {message && <p className="message">{message}</p>}
      </section>

      {results.length > 0 && (
        <section className="results">
          {results.map((item, index) => (
            <article className="club-card" key={`${item.normalized}-${index}`}>
              <div className="logo-wrap">
                {item.club?.logoUrl ? (
                  <img
                    src={`/api/logo?url=${encodeURIComponent(item.club.logoUrl)}`}
                    alt={`Escudo ${item.club.name}`}
                  />
                ) : (
                  <span className="no-logo">?</span>
                )}
              </div>

              <div className="club-info">
                <span className={`status ${item.status}`}>
                  {item.status === "found"
                    ? "Encontrado na FPF"
                    : item.status === "ambiguous"
                    ? "Correspondência ambígua"
                    : item.status === "not_found"
                    ? "Não encontrado na FPF"
                    : "Erro na consulta FPF"}
                </span>

                <h2>{item.club?.name || item.normalized}</h2>
                <p className="original">PDF: {item.original}</p>
                {item.message && <p className="original error-detail">{item.message}</p>}

                {item.status === "ambiguous" && item.candidates?.length ? (
                  <div className="candidates">
                    {item.candidates.map((candidate, i) => (
                      <div className="candidate" key={`${candidate.id}-${i}`}>
                        {candidate.logoUrl && (
                          <img
                            src={`/api/logo?url=${encodeURIComponent(candidate.logoUrl)}`}
                            alt=""
                          />
                        )}
                        <span>{candidate.name}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {item.club?.url && (
                  <a href={item.club.url} target="_blank" rel="noreferrer">
                    Abrir clube na FPF ↗
                  </a>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      <footer>
        Fonte:{" "}
        <a
          href="https://www.fpf.pt/pt/competicoes/clubes"
          target="_blank"
          rel="noreferrer"
        >
          FPF — Clubes
        </a>{" "}
        e Centro de Resultados oficial da FPF.
      </footer>
    </main>
  );
}
