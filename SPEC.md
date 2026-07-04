# Buoyant Take-Home: Design Decisions & Build Spec

Handoff document for the Buoyant founding engineer take-home. Everything decided during Friday 7/3 planning. Treat this as the working brief for scaffolding in Claude Code. Sources treated as gospel: Jackie's email (7/3), the take-home brief, the fixtures zip, trybuoyant.ai.

## Status and calendar

- Deadline: Wednesday July 8, 11:59pm PST. Internal target: submit midday Wednesday. The gap is disaster buffer.
- Fri 7/3: planning done. Group chat opened 11:18am, scoping question answered by Eric, token received and verified on both proxy endpoints same day. Remaining tonight: repo init, spec commit, laptop check.
- Sat 7/4: off or light.
- Sun 7/5: core build day. Definition of done: full loop works on the deployed Vercel app with easy.pdf, not just localhost.
- Mon 7/6: fully booked elsewhere. Zero Buoyant work. If the build is 70% done Sunday night, close the laptop anyway.
- Tue 7/7: final integration on their proxy, eval run, KB grounding if core is solid, README, DOCX export only if everything else is done.
- Wed 7/8: buffer, final deploy check, submit midday.
- Extension valve exists (Jackie: "if you need more time we can talk about it") but is break-glass only. Do not plan around it.
- Build machine: laptop (same machine as the demo call). Plug into a desktop monitor if wanted, but one environment only.

## Grading model (their words)

- Hard pass bar: "a submission that doesn't close this loop won't pass review." The deployed app must run the full loop on easy.pdf.
- "The README is part of how we grade." Seven required sections, mapped below.
- Hidden fixture: "we may run your solution against an additional test fixture we didn't share." Design for the class, not the file.
- Unsquashed commit history: they read how the work evolved. First commit is this spec. Narrative: scoping, then core loop, then eval, then additions.
- They reward: UX details, performance choices, product taste, polish. They punish: feature quantity, impressive-but-ungrounded work.
- 45-min follow-up: 10 min customer demo (Jackie register), 25 min code pushback (Eric register, every line defensible two follow-ups deep), 10 min v2 vision.

## Corpus diagnostics (verified 7/3)

- All 7 PDFs (easy, hard, 5 KB docs) are Canva exports with clean embedded text layers and unicode maps. Nothing is scanned. File sizes (12 to 18MB each) are photos.
- Deterministic extraction of the entire 118-page corpus: ~4.5 seconds. Rasterizing all 8 pages of easy.pdf: ~4 seconds. Their "5 to 10 minutes for AI-based parsing" warning applies only to vision-model pipelines. Do not build one for the happy path.
- easy.pdf: 8 pages, "City of Dixon SOQ" by MECO Engineering. Extraction quirk: page 1 emits "Statement of Qualifications" twice (layered Canva text effect). Extraction output needs dedupe/cleanup, not blind trust.
- Text layer confirmed firsthand 7/3: Nick selected and copied full text of easy.pdf in a viewer. Only raster logo text was missing (expected).
- Cleanup rules from the Ctrl-A dump (all become parser requirements and failure-mode README bullets):
  - Stacked text dedupe: layered runs at near-identical coordinates with identical content collapse to one. Handle N copies, not just pairs (title interleaved as "SSttaatteemmeenntt", closing page tripled "Thank You Thank You Thank You").
  - Letter-spaced decorative text: consecutive single-character items on a line rejoin into words, or the block is classified decoration and excluded from editable set (contact block extracted as "D o n J e n k i n s").
  - Page furniture filter: lines recurring at the same page position across pages (footers, address strips) classified as furniture, not editable paragraphs.
  - Small-caps extracts lowercase ("Scott vogler, pe"): cosmetic, leave as-is.
- Layout is designed brochure, not flowing document. Page 3 has side-by-side regions (client list left, team roster right). pdftotext reading order happened to be sane, but position-aware block grouping is the correct approach, not raw line order.
- Segmentation gift: MECO uses ALL-CAPS red headings consistently (RELEVANT EXPERIENCE, YOUR TEAM). Free section boundaries.
- KB corpus shares the pipeline: same parser handles knowledge base ingestion. Consistent firm voice across all 5 docs (confirmed by their README).
- easy.pdf entities: city names, engineer names, PE license numbers, addresses. This is the raw material for the eval golden set.

## Corpus diagnostics, round 2 (pdf.js measurement, added 7/4)

Round 1 above was measured with pdftotext, which applies its own layout analysis before emitting text. The app builds on pdf.js, which emits raw content-stream order (the order Canva drew the text). That evidence does not transfer between tools, so before writing any parser code the corpus was re-measured with pdf.js itself: all 7 fixtures, 118 pages, roughly 5,100 text items. Diagnostic scripts live in gitignored context/diagnostics and seed the parser unit tests. Findings, each with its consequence:

- Emission order is not trustworthy across the class. easy.pdf pages score 0.85 to 1.00 on monotonic top-to-bottom order, but KB docs drop to 0.75 on their worst pages. Geometric sorting (y with tolerance, then x) is mandatory, not optional.
- easy.pdf page 3 is a single full-width column in the text layer: the client list flows above YOUR TEAM and every line starts at the same left margin. The side-by-side-regions finding from round 1 does not survive pdf.js measurement, and true multi-column never appears in any fixture's text layer. Column handling is cut from the parser.
- Stacked duplicates are corpus-wide and simpler than round 1 suggested: whole-string repeats on a single line (the title three times, the closing Thank You three times), not character interleaving. Dedupe rule: collapse repeated identical runs within a line.
- Letter-spaced single-character items: zero in easy.pdf, 6 to 15 in every other doc. The rejoin rule is real for the class but moves from the core loop to KB ingestion.
- Wide in-line gaps (over 100pt) appear in every doc and are left/right aligned pairs (address left, date right), not columns. Rule: split a line into separate spans at a large gap.
- MECO headings (YOUR TEAM, RELEVANT EXPERIENCE) are size 12, identical to body text. A font-size heuristic alone finds zero headings here. Primary signal: ALL-CAPS short line. Fallbacks for the hidden fixture: font-size jump, then whitespace gap before the block.

Net effect: two planned parser features deleted because measurement showed their problems do not exist, one promoted from optional to mandatory, and every remaining rule traceable to an observed defect. Exact tolerances get tuned against the same diagnostics during the build.

## Architecture decisions

### Parsing: source-type router (RedlineIQ pattern)

1. Check for text layer first.
2. Text layer present: deterministic extraction with per-item coordinates (pdf.js), group items into blocks by position, segment into paragraphs, detect ALL-CAPS headings as section boundaries, dedupe layered text.
3. No text layer detected: graceful failure only. Clear user-facing "this looks like a scanned document, not supported yet" message. Full vision path cut per Eric 7/3 ("scan is pretty rare"). Silent empty render is the failure mode to prevent.
4. README framing: all provided fixtures have text layers; parse is instant and near-zero spend; the router exists for the scanned class.

### Deployment trap: Vercel body limit

- Fixtures are 12 to 18MB. Vercel serverless functions reject request bodies over ~4.5MB. Naive upload-to-API-route works locally and fails deployed, and the pass bar is the deployed app.
- Decision: parse client-side with pdf.js in the browser. The file never crosses the wire; only extracted structure (kilobytes) goes to the server. Keeps parse instant for the user.
- Alternate if client-side parse fights back: Vercel Blob client-direct upload, parse from storage.
- Sunday definition of done includes verifying the deployed upload path with easy.pdf itself, not a small test file.

### Caching

- "Cache parse results" is an explicit instruction in their materials. Treat as graded.
- Cache parsed block structure keyed by file hash. Parse once at upload, serve from cache after. Protects their spend caps if any LLM-assisted step exists, and generalizes to the hidden fixture.

### Provider and API protocol

- Anthropic only. Reasoning in README: deep SDK familiarity, one provider done well beats shallow dual-provider.
- Env abstraction: ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY read from env, nothing hardcoded. Own key during iteration, their proxy for final runs.
- Token protocol: (1) DONE 7/3: verified via curl against both proxy endpoints. Anthropic /v1/messages returned a valid completion (Haiku, 9 in / 4 out tokens); OpenAI /v1/models returned the model list. Single token covers both, proxy behaves like the official APIs as documented; (2) Sunday build runs on own key; (3) Tuesday: swap env to proxy, run full flow, run eval suite through proxy (captures the honest cost number), set token as Vercel env var so the deployed app runs on their proxy, re-verify deployed app after swap; (4) never commit or paste the token anywhere. Token stored outside the repo folder.
- Cost line for README: rough per-eval-run and per-edit spend. Cost awareness is a production signal.

### Data layer

- No database. Edit state lives client-side. Their brief: "if you're not sure, you don't need one." That sentence is the answer.

## UX shape (their product philosophy)

- Document-centric, not chat-centric. Their positioning: "less a chatbot you operate, more a digital employee," always human-reviewed. A chat transcript with the document as afterthought contradicts their identity.
- The take-home is their product's step 03 in miniature: "Refine in place. Select a paragraph, ask for a rewrite." Frame the demo that way.
- Required interaction: select block, type instruction, proposed edit rendered as diff against the document, explicit apply/reject, section-aware confirmation (their mock: "Edit applied, Section 3"), visible edit history, undo.
- Rendering: structured styled text blocks, not visual PDF reproduction. They waived fidelity twice (brief + zip README, with the licensing-cost explanation). Quote their own reasoning in the cuts section.

## Scope

### Core loop (must ship, Sunday)

1. Upload PDF (client-side parse)
2. Extract and segment into blocks with section awareness
3. Render blocks as selectable units
4. Select block, type instruction, get proposed edit
5. Diff view, apply or reject
6. Edits compose, edit history, undo
7. Deployed on Vercel, working end to end on easy.pdf

### Production-grade essentials (ship with the core loop)

Added 7/4 after a production audit. The deployed app is a public URL wired to their API token; these are guards inside code the loop already requires, not features. Rough cost 1.5 to 2 hours.

1. Input guards at every entry point: file type and size caps, page-count cap on parse, instruction and block length caps on the edit endpoint. Nothing unbounded reaches the parser or the model.
2. Distinct honest parse-failure messages: scanned, corrupt or unreadable, password-protected, parsed-but-zero-editable-blocks. Closes every door to a silent empty render.
3. Edit-call failure states with a retry button: proxy down, rate limited, spend cap hit, timeout. The UI always says what happened. SDK built-in retries cover transients; no custom retry logic.
4. Model output validated before anything renders into the diff. Identical-text results surface as "no change proposed"; refusals surface honestly.
5. Concurrent-edit guard: one in-flight request per block; applying a proposal against changed block state is impossible by construction.
6. Prompts treat document text as data, never instructions. System instruction, user instruction, and document content structurally separated.
7. React error boundary around the document view: one bad block never takes down the app.
8. Logging: latency, token counts, model, outcome per edit call. Never document content. Feeds the README cost line.
9. Env validation fails fast: a missing key or base URL produces a clear error, not a cryptic 500. Matters for the Tuesday proxy swap.
10. Function timeout defused: maxDuration set explicitly on the edit route, streaming keeps the connection alive, verified with a slow edit on the deployed app. Same trap shape as the body limit.
11. npm run verify (typecheck, lint, parser tests) before every push.

Time-permitting Tuesday: keyboard and focus basics on apply/reject; CI running verify. Document-only in the README: rate limiting (size caps are the v1 mitigation; first thing to add before a real customer) and a privacy and retention statement (the file never leaves the browser, only selected block text goes out per edit, nothing retained server-side).

### Addition 1: KB grounding (Tuesday, if core solid)

- Ingest 5 MECO proposals with the same parser at build time.
- Two uses: factual retrieval ("add a sentence about similar projects" pulls real MECO projects) and voice exemplars (rewrites include 1-2 MECO excerpts as style references). Facts plus voice from one corpus; maps to their lead marketing claim ("learns how your firm writes").
- No vector DB. Keyword or simple similarity over 5 documents. README line: "5 documents don't need a vector database."

### Addition 2: the eval (Tuesday, required by brief, do it properly)

- Golden set: 10 to 15 labeled edit cases on easy.pdf (name fixes, rewrites, tone changes, additions).
- Two metrics, chosen because they mirror Buoyant's own Review product: edit faithfulness (changed what was asked and nothing else) and name fidelity (entity names, cities, PE numbers preserved or correctly modified).
- Run against the deployed app through their proxy. Publish the real number even if mediocre, with diagnosis. Honest rebaselining is the RedlineIQ signature move; an inflated number will not survive a real code review.

### Maybe (only if everything above is done)

- DOCX export (ranked first): consultants finish in Word; mirrors their export step; docx npm package, blocks map to paragraphs/headings, ~1 hour. Markdown export is the 10-minute fallback.
- Page-image context panel (ranked second): rasterized page image alongside editable blocks for visual context. Cheap but lower value than DOCX.

### Explicit cuts (README section, with reasons)

- PDF export: they steered away twice; quote their licensing-cost reasoning back.
- Multi-paragraph chat: hardest stretch goal, weakest value per hour at this scope.
- hard.pdf tuning: build for the class (single-column digital PDF with text layer), degrade gracefully, don't hardcode for tables/multi-column.
- Database: their own brief answers this.
- Buoyant site features (go/no-go scoring, compliance matrices, CRM sync, image auto-labeling): known scope-creep hazards, not built.

## README section ammo map

- Setup & run: standard.
- Design decisions: router architecture with corpus evidence; client-side parse with the Vercel body-limit reasoning; document-centric UX with their positioning quoted; Anthropic-only reasoning.
- What I cut and why: the cuts list above. Highest-signal section per their brief; be specific.
- Failure modes: Vercel body limit (found and defused); layered-text duplication; region interleaving on multi-column pages; scanned-document case and the graceful-failure message; silent empty render prevention; what to check before a paying customer touches it.
- How I'd evaluate: the golden set, both metrics, real numbers from the deployed app, per-run cost.
- What I added beyond the brief: KB grounding (facts + voice), DOCX export if shipped, and the reasoning.
- Next 8 hours: pulls from the v2 answer below.

## Process rules

- Repo public. MECO PDFs gitignored: "shared with permission" for assessment is not permission to republish a real firm's proposals on public GitHub. Note this in the README (professionalism signal).
- Token never committed. .env.example with placeholder names only.
- Commit history tells the story: spec first, then core, then eval, then additions. Real commit messages.
- All writing (README, commits, demo): no em dashes, no AI-sounding language.

## Demo prep (45 min, two registers)

- 10 min demo, Jackie register: demo as the persona. "I'm a consultant recycling this Dixon SOQ for a new city." Story: understood their core product interaction, rebuilt its essence.
- 25 min pushback, Eric register: every design decision above has its defense written next to it. Two follow-ups deep on all of it.
- Layout-fidelity tension, if poked: the take-home isolates the edit loop from the fidelity problem their real product solves inside Word's own format. Their README granted this twice.
- 10 min v2 answer (prep, don't improvise): harden parse for the hard-fixture class; grow per-paragraph edits into multi-section chat; add a lightweight review pass (their consistency and name checks); acknowledge the endgame is a Word add-in, which is their actual architecture. Build their published roadmap, not a parallel one.

## Gospel reference architecture guide

```
proposal-editor/
  SPEC.md              committed, first commit, source of truth
  CLAUDE.md            committed, the guardrail
  context/             gitignored
    brief.md           full take-home brief, verbatim
    email.md           Jackie's email, verbatim
    fixtures/          the 7 PDFs from the zip
```

## Open items

- [x] Token received 7/3, verified via curl on both endpoints (Anthropic messages call + OpenAI models list). Confirmation text sent to Jackie and Eric; channel quiet until repo submission.
- [x] Scoping question sent 7/3 3:27pm, Eric answered 7/3: "They're typically done in Word or InDesign so scan is pretty rare." Also confirmed API key incoming.
  - DECISION LOCKED: vision fallback is detection + graceful message only. Full vision path (rasterize, Claude Vision extract, merge) is cut. Freed Tuesday hours go to KB grounding and eval.
  - README cut entry, in Eric's words: customer proposals are typically Word or InDesign exports, scans are rare; built detection and a clear "scanned document not supported yet" message instead of a full OCR pipeline, spent the hours on the edit loop and eval.
  - Side confirmations from his answer: hidden fixture is almost certainly a digital export (parser class assumption holds); "Word or InDesign" independently validates DOCX export as the right maybe-addition and the Word add-in as the v2 endgame.
- [x] Repo init + this spec as first commit (done 7/4)
- [x] Laptop environment check: Node, git, Claude Code ready (verified 7/4: Node v22.14.0, git 2.54, gh authed)
