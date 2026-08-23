"use client";

import { useState } from "react";

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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function processPdf() {
    if (!file) return;

    setBusy(true);
    setMessage("");
    setResults([]);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch("/api/process", { method: "POST", body });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Erro ao processar o PDF.");

      setResults(data.results || []);
      setMessage(`Foram identificadas ${data.teamCount ?? 0} equipas.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">FPF • ESCUDOS OFICIAIS</span>
        <h1>Gerador de Escudos</h1>
        <p>
          Carrega um PDF de nomeações. A aplicação identifica as equipas,
          ignora os sufixos SUQ, SDQ, OAF, B e SAD no fim do nome e procura a
          correspondência no índice oficial da FPF.
        </p>
      </section>

      <section className="card">
        <label className="dropzone">
          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setResults([]);
              setMessage("");
            }}
          />
          <span className="upload-icon">↑</span>
          <strong>{file ? file.name : "Escolher ficheiro PDF"}</strong>
          <small>PDF de nomeações da FPF</small>
        </label>

        <button className="primary" disabled={!file || busy} onClick={processPdf}>
          {busy ? "A analisar…" : "Ler PDF e procurar equipas"}
        </button>

        {message && <div className="message">{message}</div>}
      </section>

      {results.length > 0 && (
        <section className="results">
          {results.map((item, index) => (
            <article className="club-card" key={`${item.normalized}-${index}`}>
              <div className="logo-wrap">
                {item.club?.logoUrl ? (
                  <img
                    src={item.club.logoUrl}
                    alt={`Escudo ${item.club.name}`}
                    loading="lazy"
                  />
                ) : (
                  <span className="no-logo">?</span>
                )}
              </div>

              <div className="club-info">
                <span className={`status ${item.status}`}>
                  {item.status === "found" && "Encontrado na FPF"}
                  {item.status === "ambiguous" && "Correspondência ambígua"}
                  {item.status === "not_found" && "Não encontrado"}
                  {item.status === "error" && "Erro"}
                </span>

                <h2>{item.club?.name || item.normalized}</h2>
                <p>PDF: {item.original}</p>
                {item.message && <p className="detail">{item.message}</p>}

                {item.candidates?.map((candidate) => (
                  <div className="candidate" key={candidate.id}>
                    <span>{candidate.name}</span>
                  </div>
                ))}

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
        Fonte dos clubes e escudos: <a href="https://www.fpf.pt/pt/competicoes/clubes" target="_blank" rel="noreferrer">FPF</a>.
      </footer>
    </main>
  );
}
