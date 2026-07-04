# Proposal Editor

Upload a proposal PDF, select a paragraph, ask for a rewrite, review the diff, apply or reject. Built for the Buoyant take-home.

Live at [refine-proposals.vercel.app](https://refine-proposals.vercel.app).

Work in progress. The full README (design decisions, cuts, failure modes, eval) lands with the final submission.

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY
npm run dev
```

## Scripts

- `npm run dev` - local dev server
- `npm run build` / `npm start` - production build and serve
- `npm run verify` - typecheck, lint, and parser tests; run before every push
