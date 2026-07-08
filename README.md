# Proposal Editor

[![verify](https://github.com/nick-furr/proposal-editor/actions/workflows/verify.yml/badge.svg)](https://github.com/nick-furr/proposal-editor/actions/workflows/verify.yml)

Upload a proposal PDF, select any paragraph, describe a change in plain language, review the proposed edit as a word-level diff, apply or reject it, undo, export the edited document to Word.

Live: **https://refine-proposals.vercel.app**

The interaction is document-centric by design: every change is human-reviewed and nothing applies without a diff. Edits are grounded in the firm's past proposals where the instruction calls for facts.

## Setup & run instructions

Requires Node 22.

```bash
npm install
cp .env.example .env   # add your ANTHROPIC_API_KEY
npm run dev            # app on localhost:3000
```

`ANTHROPIC_BASE_URL` and `ANTHROPIC_MODEL` are also read from env (defaults: the public API, `claude-sonnet-5`). The deployed instance runs on the provided proxy and token via Vercel env vars.

Other commands:

```bash
npm run verify   # typecheck + lint + tests (same as CI)
npm run eval     # golden-set eval, see eval/README.md
```

The knowledge base is optional: without `KB_INDEX_PATH` (a local JSON file) or the private Blob store, edits run ungrounded and the server logs one notice. See "A note on the fixture data" for why the index is not in the repo.

## Design decisions

**PDFs parse in the browser, and the file never crosses the wire.** The fixtures are 12 to 18MB and Vercel serverless rejects request bodies over about 4.5MB. A naive upload-to-API-route works on localhost and fails deployed, and the pass bar is the deployed app. pdf.js runs client-side; only extracted block structure (kilobytes) reaches the server, per edit. This is also the privacy story: the document never leaves the machine, only the selected block's text goes out. The parser checks for a text layer before anything else: a scanned document gets a clear not-supported-yet message up front (the vision pipeline is a documented cut), never a silent empty render.

**Recovering structure, the problem the brief names, in full.** pdf.js does not give you paragraphs; it gives positioned text runs in the order the design tool drew them. Measured across the corpus, emission order is not trustworthy: the primary fixture's pages score 0.85 to 1.00 on monotonic top-to-bottom order, but corpus pages bottom out at 0.75. So recovery is a deterministic geometric pipeline, with no LLM anywhere in it (parsing is instant and costs nothing; the model spend is entirely per-edit):

1. Extract every text item with coordinates and font size.
2. Geometric sort: y with tolerance bucketing, then x. Mandatory, per the 0.75 worst-page score.
3. Assemble lines. Within a line: glue fragments closer than 1.5pt with no space (words arrive torn at arbitrary points, "M|icrosoft"; the corpus gap distribution is bimodal, fragments under 1pt and word spaces from 2pt, so the threshold sits in the empty zone), collapse whole-string duplicate runs (layered Canva text stacks the title three times), and split spans at gaps over 100pt (measured to be left/right aligned pairs like address and date, not columns).
4. Group lines into blocks by vertical gap relative to the page's typical leading.
5. Filter page furniture: the same text at the same y-band across three or more pages is a footer, not an editable paragraph.
6. Classify headings: ALL-CAPS short line first, because this fixture's headings are the same font size as body text and a font-size heuristic alone finds zero of them; font-size jump and whitespace gap are fallbacks so the hidden fixture has two more chances. Heading-ness is classified per line and consecutive heading lines merge: both rules exist because driving the parser against the real corpus caught headings being swallowed into paragraphs (they sit one leading above their body text) and two-line display titles producing phantom sections.
7. Sections are heading-to-heading spans, and every block belongs to one. That is what makes edits section-aware, from the confirmation toast to the eval's target matcher.

**Three planned parser features died by measurement.** Before writing parser code I ran pdf.js over all 7 fixtures (118 pages, about 5,100 text items) and derived the pipeline above from what was actually there. A page-3 column patch and a letter-spacing rejoin rule died cleanly: the page is single-column in the text layer, and the letter-spacing artifact never appears in pdf.js output. The generalized column engine died on narrower evidence than I first recorded. The primary fixture's editing path does not need one, but layout-built pages elsewhere in the corpus do carry real side-by-side content; my diagnostic note overstated that as corpus-wide absence, the hard-fixture smoke test surfaced the overreach, and the spec carries a dated correction. The cut stands, and a column model leads the next-8-hours list.

**Parse results cache by file hash, keyed with the parser version.** Parse once at upload, serve from cache after. The version in the key means a parser change can never serve stale structure.

**The render is structured styled text, not a visual PDF reproduction.** The brief waived pixel fidelity twice, with the licensing-cost explanation. Blocks render as selectable headings and paragraphs; extracted text and model output render as React text nodes, never injected HTML.

**The UI is a document with an edit panel, not a chat with a document attached.** The document owns the screen; selecting a block opens one instruction box scoped to it, and the conversation never becomes the artifact. Everything the user does lands somewhere inspectable: the proposal streams into the panel, the diff is the decision surface, applying confirms with the section name, and history sits beside the document rather than replacing it.

**Edits stream as plain text deltas, not SSE.** The payload is a single monotonically growing string; SSE framing buys nothing and costs a client-side parser. The proposed text streams into the panel as it arrives and the diff renders when the stream completes, so the user sees motion instead of a spinner. Streaming also keeps the function connection alive: the slowest measured edit (22.3s) finished well inside the route's 60s ceiling.

**The diff is word-level.** Character diffs are noise and line diffs are useless on single-paragraph blocks. jsdiff's diffWords carries zero transitive dependencies, and a hand-rolled LCS gets edge cases wrong exactly where a code review pokes.

**Next 15 with webpack, pinned.** The proven pdf.js worker bundling path (new URL with import.meta.url) is webpack's; newer scaffolds default to Turbopack. One bundler, one set of behaviors, and the worker verified as a hashed static asset in the production build rather than the silent fake-worker fallback.

**The model output protocol was tuned by eval receipts, not intuition.** Three rules exist because a measured run demanded each one: a no-annotations rule (a date fix once rendered as "April 14 -> May 24" instead of the edited text), an all-or-nothing REFUSED: sentinel (a refusal note once got appended to an otherwise correct rewrite, which would render into the diff as inserted text), and a scope rule that applies the in-scope part of an instruction and silently disregards the rest (an early run refused an entire edit because the instruction mentioned another section).

**Sonnet 5 per edit, decided by a one-variable experiment.** Haiku 4.5 on the same golden set: 12/14 faithfulness against Sonnet's 14/14 at the time, with both misses being length-control failures. Haiku is 2.5x faster (p50 1.1s vs 2.8s) and a quarter the cost, but instruction-following precision is the product. At roughly $0.004 per edit the cost difference does not matter; a routing split (Haiku for mechanical swaps, Sonnet for prose) is v2 material the eval data already supports.

**Adaptive thinking stays on, also measured.** Disabling it won 1.6x on latency and 40% on output tokens, and dropped the eval from 15/15 to 11/15. The failure mode is silent: entities (a distance, an officer name, a city) vanish from otherwise plausible rewrites. Name fidelity is the product, so the latency stays.

**Retrieval is lexical because five documents do not justify an embedding dependency.** The knowledge base is the firm's five past proposals, parsed by the same parser, chunked to paragraphs, deduped, and searched by IDF-weighted keyword overlap against the instruction. Querying with the instruction only (not the block) was itself a measurement: including the block text retrieved near-copies of the paragraph under edit instead of new material. `retrieve(index, query, k)` is a deliberate seam: dense or hybrid retrieval drops in behind the same signature when the corpus outgrows keyword matching, and the failure modes section documents the exact query where the lexical approach hit its ceiling.

**No database.** The brief says "if you're not sure, you don't need one," and every piece of state here is per-user, per-session, per-document. Edit history is an append-only event log (undo appends an undo event rather than popping), so the whole history is serializable; it persists to localStorage keyed by file hash, which is why a refresh restores applied edits. Undo is deliberately linear: the document only ever walks back through states a human approved, and selective revert with conflict detection is an additive change the log already supports. When persistence is added later, the log becomes an audit trail of AI edits, which for firms signing government proposals is a compliance feature, not storage.

**Anthropic only.** One provider done well beats two done shallowly. Base URL, key, and model all come from env; the deployed app runs unmodified against the provided proxy, and the eval measured the proxy as behaviorally identical to the public API (statistically identical scores, latency, and token counts).

**Document text is data, never instructions.** The system prompt, user instruction, and document content are structurally separated, and the prompt states that text inside the document tags is content. Untrusted PDF text never rides in the instruction channel.

## What I cut and why

**PDF export.** The materials steered away from it twice, citing the licensing cost of high-fidelity PDF tooling. Consultants finish proposals in Word anyway ("They're typically done in Word or InDesign"), so the export is DOCX.

**A full OCR/vision pipeline for scanned documents.** The team's answer to my scoping question: proposals are typically Word or InDesign exports, "so scan is pretty rare." The app detects a missing text layer and says plainly that scanned documents are not supported yet. The hours went to the edit loop and the eval instead.

**hard.pdf tuning, including a column engine.** The parser is built for the class (single-column digital exports with text layers) and degrades gracefully outside it. hard.pdf's resume pages are real two-column layouts and are where a column model would earn its place; the failure modes section reports exactly how they degrade today. Hardcoding for one difficult fixture the reviewers happen to hold is designing for the file, not the class, so the column model is scoped as the first v2 item instead of a submission-eve patch.

**A database.** Answered above by their own brief.

**Multi-paragraph chat.** The hardest stretch goal and the weakest value per hour at this scope. I felt this cut twice during persona testing (a document-wide city swap means re-issuing the edit block by block), and that experience is the v2 argument: region-scoped instructions composing the same per-block primitive, one reviewed diff per touched block, audit trail intact.

**The rest of the product category.** Go/no-go scoring, compliance matrices, CRM sync: known scope-creep hazards, not built.

**Rate limiting on the edit endpoint, documented instead of half-built.** Real limiting on serverless needs shared state, a dependency this scope does not justify. Input caps (file size, page count, instruction and block length) are the v1 mitigation. This is the first thing to add before a paying customer touches the URL.

## Failure modes I worried about

**Found and defused: the Vercel body limit.** Described under design decisions; the reason parsing is client-side.

**Parse failures are enumerated, never silent.** Scanned (no text layer), corrupt, password-protected, and parsed-but-zero-editable-blocks each produce a distinct message. A silent empty render is impossible by construction, and the error states were tested by inducing each failure, not by assuming.

**Extraction artifacts are the terrain, not edge cases.** Layered Canva text stacks duplicates ("Thank You" three times on one line), words fragment mid-token, small-caps type extracts as the casing the designer actually typed ("Scott vogler, pe" is faithful extraction of a real typo the font was hiding). The parser fixes what measurement justified and leaves casing alone: a parser that guesses casing silently rewrites names like McDonald.

**The layout-heavy fixture degrades to editable prose, not to a crash.** hard.pdf (19 pages) was smoke-tested on the deployed app: it parses into 134 blocks and the full loop works on its narrative sections. Layout-driven pages degrade as designed: two-column resume pages interleave sidebar content into bio prose mid-sentence, a staff capacity chart renders as one section per person whose body text is a bare percentage, and a services matrix shatters into orphan sections. Short label lines read as headings, so it yields 57 sections where easy.pdf yields 12. The failure mode is edit quality on interleaved blocks, never app behavior. List structure is likewise not recovered: the block model has heading and paragraph kinds only, so bullet lists render as run-on prose.

**Grounding can mis-ground, and the reviewed diff is the control.** Found during persona testing: on the surveying-license block, the vague instruction "update license" produced a proposal that overwrote it with the firm's engineering license (a different license number and officer), because keyword retrieval matched "license" to the wrong entity's boilerplate and the grounding rule handed the model plausible facts. Not fabrication: every token traced back to the knowledge base. Every link behaved as designed and the composition was still wrong, which is exactly why no edit applies without a human-reviewed diff; the wrong license number showed up in red and got rejected on sight. The v2 fix is an entity-consistency guard (reference identifiers never replace in-block identifiers) plus a retrieval relevance threshold.

**Block-scoped edits can strand collateral facts.** Swap the client city in one block and a "55 miles from" claim elsewhere in the paragraph may quietly stop being true; clean extraction debris out of a block and a name that existed nowhere else leaves the document entirely. The diff shows every change honestly, but nothing yet checks document-level consistency after an apply. That check is the v2 review pass.

**One eval case flaps, and it is reported, not tuned away.** See the next section.

**Before a paying customer:** rate limiting and abuse protection on the edit endpoint, monitoring beyond per-edit structured logs, and a written retention statement. The current facts are good ones: the file never leaves the browser, only selected block text goes to the model, nothing is retained server-side, and logs carry latency, tokens, and outcome but never content.

## How I'd evaluate this (and how I did)

The eval is a golden set of 16 labeled edit cases against the shared fixture, run through the live `/api/edit` route with the app's own parser, scored by deterministic string checks. No LLM judge: exact checks are reproducible, free, and defensible line by line. Two metrics, chosen to mirror the failure classes that matter in this product:

- **Edit faithfulness**: did the edit do what was asked and nothing else (change proposed or correctly refused, required strings present, forbidden strings absent, length within bounds).
- **Name fidelity**: entities (names, cities, PE license numbers) preserved, removed, or added exactly as instructed.

The cases are built from the corpus's real defects: an extraction-scrambled block that interleaves officer names with a state list, a small-caps casing fix, a phone number extracted into the middle of a pull quote, a real date inconsistency between the cover and the letter, and an adversarial instruction that mentions another section. One case I added after red-teaming my own set: renew both corporate license expirations, where the trap is changing the adjacent license number too (it passed, changed ratio 0.06, only the year moved).

The headline number comes from the deployed app through the provided proxy, which is the same path a reviewer uses: **14/15 faithfulness, 15/15 name fidelity, p50 2.8s, about $0.06 per full run, about $0.004 per edit.** A later 16-case run (after adding my case) scored 16/16 on both metrics locally.

What the numbers hide is more useful than the numbers:

- The baseline run's failure is the whole story of the system prompt. Asked to give an engineer a "newer-looking" PE license number, the untuned model fabricated one (MO PE No. PE-2021000147). Credential fabrication on request, on a government proposal, is the catastrophic failure class. The anti-fabrication rule fixed it, then over-refused legitimate edits, then a scope rule recovered those. Three runs, receipts kept for each.
- The one recurring miss is a flap, diagnosed: on the trivial date-fix case the model occasionally returns the input verbatim, surfacing as the designed "no change proposed" state. It moved between cases across runs but the aggregate held at 14/15. I did not tune the prompt to reach 15/15 because that is training on the test set.
- Deterministic checks trade recall for precision, and I know where the boundary is: a rewrite that renders "13 engineers" as "thirteen engineers" passes a human read and fails a substring check. That boundary is where an LLM-judge column would add value.

Model pricing was verified against the provider's published rates during the eval (Sonnet 5 at the current intro rate; Haiku 4.5 for the comparison run). Cost per edit is logged per call from real token counts, never estimated.

In production, knowing it still works well is the same two metrics plus the live signals the logs already carry: the golden set runs as a scheduled regression against the deployed route, and per-edit structured logs track latency, token spend, refusal rate, and no-change rate. The one metric only real users can produce is the apply/reject ratio: users rejecting a rising share of proposals is the earliest honest signal that edit quality regressed, and it requires logging nothing but the outcome the app already knows.

## What I added beyond the brief and why

**Knowledge-base grounding.** The five past proposals are ingested by the same parser, indexed, and retrieved per edit; factual additions ground in real past work, and the same excerpts double as register references so added sentences read like the firm wrote them. During persona testing, "add a sentence noting MECO's wastewater treatment work" produced a sentence about a named town's treatment plant upgrade with a concrete clarifier structure, traceable near-verbatim to one source chunk. The same pipeline's measured limits (the vocabulary-mismatch miss, the mis-grounding case) are reported above rather than sanded off.

**DOCX export.** Consultants finish in Word, per the team's own words. The export builds a Word document from the parsed structure with the edit log folded in, headings mapped to Word heading styles. Client-side, lazy-loaded, verified by opening the output in Word itself.

**Production posture on a public URL wired to a real token.** Input caps at every entry point, enumerated failure states with retry, a concurrent-edit guard, output validation before anything renders, env validation that fails fast, an error boundary around the document view, and structured per-edit logs with no content in them. CI runs typecheck, lint, and the parser and eval-metric tests on every push.

**Interaction details.** Streaming proposals, section-aware apply confirmations, keyboard path (instruction box focuses on select, Enter applies a focused proposal, Escape rejects or cancels), refusal messages that coach the retry, history with undo that survives refresh, and a clear-history control that names its consequence before acting.

## A note on the fixture data

The fixture corpus is a real engineering firm's past proposals, shared for assessment. Shared for assessment is not permission to republish on public GitHub, so the PDFs, the parsed knowledge-base index, the golden-set cases (which quote them), and all eval reports live outside the repo; the index reaches the deployed app through private Vercel Blob storage read server-side at runtime. The repo carries the machinery: parser, ingest script, retrieval, eval harness, schema, and a synthetic example case.

## What I'd build next given another 8 hours

In priority order, each continuing something the current build already measures or feels:

1. **Column detection for the brochure/resume class.** The mechanism is known (y-band line assembly merges columns); the fix is per-page x-clustering to route lines into column groups before block assembly, built against the hard fixture with a regression net over the easy one.
2. **Multi-section chat.** Region- or document-scoped instructions that compose the existing per-block primitive: one reviewed diff per touched block, apply-all with per-block reject, audit trail unchanged. Felt twice during persona testing; the primitive is already shaped for it.
3. **A post-edit consistency pass.** After an apply, check the document for stranded collateral facts and last-occurrence removals, and suggest follow-up edits. The eval already has the cases that would grade it.
4. **Grounding guards.** Entity-consistency between block and retrieved references, a retrieval relevance threshold, and the mis-grounding case added to the golden set as a known-failing regression target.
5. **Selective undo.** The append-only log already supports reverting any edit whose block has no later edits; conflicts prompt instead of guessing.
6. **A list block kind.** Bullet detection in the parser, list rendering in the app, Word list styles in the export.
7. **Model routing.** Haiku for mechanical single-entity swaps, Sonnet for prose; the eval data that justifies the split already exists.

The endgame for this product shape is a Word add-in, which is where the customers already live.
