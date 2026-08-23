# GeradorNomea-es

Aplicação Next.js que recebe um PDF de nomeações, identifica as equipas e procura os respetivos clubes/escudos oficiais da FPF.

## FPF

A Vercel não consulta diretamente `GetClubsByName`, porque a FPF bloqueia esse tráfego com HTTP 403.

O índice é atualizado por GitHub Actions usando Chromium/Playwright numa sessão de navegador. O resultado é guardado em `data/fpf-clubs.json`.

## Primeira utilização

1. GitHub → Actions.
2. Abrir **Atualizar índice FPF**.
3. `Run workflow`.
4. Confirmar que `data/fpf-clubs.json` foi preenchido.
5. O commit do índice dispara o deployment da Vercel.

Os escudos são carregados do servidor oficial de imagens da FPF.
