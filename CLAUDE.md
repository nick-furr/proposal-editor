# CLAUDE.md

Working rules for this repo. SPEC.md is the source of truth for scope and architecture; when in doubt, re-read it before writing code. Gospel sources (brief, email, fixture PDFs) live in `context/`, which is gitignored and never leaves this machine.

## Stack
- Next.js + TypeScript (take-home constraint), Tailwind CSS
- Dark mode first, minimalist and precision-oriented UI

## Scope guardrails
- Core loop first: upload, parse, select block, propose edit, diff, apply/reject, history, undo. Nothing else gets built until the loop works on the deployed Vercel app with easy.pdf.
- The explicit cuts stay cut: PDF export, multi-paragraph chat, hard.pdf tuning, database, full vision/OCR pipeline, Buoyant site features (scoring, compliance matrices, CRM sync). Do not build them. Reasons are in SPEC.md.

## Architecture locks
- PDF parsing happens client-side with pdf.js. The file never crosses the wire; only extracted block structure reaches the server. Reason: Vercel serverless rejects request bodies over ~4.5MB and the fixtures are 12 to 18MB.
- Parse results cached by file hash. Parse once at upload, serve from cache after.
- Anthropic only. ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY read from env, nothing hardcoded.
- No database. Edit state lives client-side.
- No text layer detected means graceful failure: a clear "scanned document not supported yet" message, never a silent empty render.
- Render structured styled text blocks, not a visual PDF reproduction.

## Process rules
- The API token is never committed, pasted, or logged. It lives outside the repo folder. `.env.example` carries placeholder names only.
- MECO PDFs stay in gitignored `context/`. Shared with permission for assessment is not permission to republish a real firm's proposals on public GitHub.
- Commit history stays unsquashed and tells the story: spec, then core loop, then eval, then additions. Real commit messages, conventional style.
- Every design decision made or revised after the spec gets appended to `context/decisions.md` with its reasoning and, if reviewer-relevant, which README section it feeds. The README distills this log at the end.
- No em dashes and no AI-sounding language in any writing: README, commits, UI copy, code comments.
