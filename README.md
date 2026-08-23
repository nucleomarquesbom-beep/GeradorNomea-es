# FPF Escudos

Aplicação Next.js que recebe um PDF de nomeações da FPF, extrai os jogos/equipas, normaliza nomes e tenta resolver cada clube através da FPF.

## O que já está implementado

- Upload de PDF.
- Leitura do texto do PDF.
- Extração das equipas a partir do campo `Jogo`.
- Remoção controlada de sufixos `SAD`, `SDUQ`, `SDQ`, `SUQ` e indicação de equipa `B`.
- Correspondência aproximada de nomes.
- Interface para mostrar o escudo quando a FPF devolve uma URL de imagem.
- Link para a página do clube na FPF.
- Sem download de escudos para o utilizador.

## Fonte

A fonte pretendida é exclusivamente a FPF:

https://www.fpf.pt/pt/competicoes/clubes

A página pública de clubes da FPF é uma interface dinâmica. Se a FPF alterar o endpoint interno que fornece os resultados, deve ser configurado `FPF_CLUB_SEARCH_ENDPOINT` no Vercel, apontando para o endpoint oficial da FPF que aceite `?q=`.

## Instalação

```bash
npm install
npm run dev
```

Abrir `http://localhost:3000`.

## Vercel

Importar o repositório GitHub na Vercel.

Não é necessário criar uma base de dados.

Se a FPF disponibilizar/alterar um endpoint interno de pesquisa, configurar:

`FPF_CLUB_SEARCH_ENDPOINT`

O código nunca usa Google, Transfermarkt, Wikipedia ou outra fonte para obter o escudo.

## Nota importante

A FPF pode bloquear pedidos automatizados ou alterar a implementação interna da página. O resolver foi isolado em `lib/fpf.ts` precisamente para que essa parte possa ser atualizada sem mexer no leitor de PDF ou na interface.

## Estrutura

- `app/page.tsx` — interface.
- `app/api/process/route.ts` — recebe e processa o PDF.
- `lib/pdf.ts` — extração/normalização das equipas.
- `lib/fpf.ts` — pesquisa e resolução dos clubes na FPF.
