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

1. Extract every text item with coordinates, size, and font identity. Rotated items are excluded as decoration: measured corpus-wide, every rotated run is display art (vertical "Thank You" titles, margin tabs), never body text.
2. Detect a column channel per page: a vertical whitespace band 10pt or wider with content mass on both sides, vertical extent, and only title lines crossing. All thresholds measured; letterhead address/date pairs are one row and never qualify.
3. Segment the page. No channel means one stream. With a channel: full-width lines first (the page title or name banner), then each column whole, ordered by which starts higher, so sidebar text never interleaves into body prose and a resume reads name, bio, then sidebar.
4. Geometric sort within each stream: y with tolerance bucketing, then x. Mandatory, per the 0.75 worst-page score.
5. Assemble lines. Within a line: glue fragments closer than 1.5pt with no space (words arrive torn at arbitrary points, "M|icrosoft"; the corpus gap distribution is bimodal, fragments under 1pt and word spaces from 2pt, so the threshold sits in the empty zone), collapse whole-string duplicate runs (layered Canva text stacks the title three times), and split spans at gaps over 100pt (measured to be left/right aligned pairs, not columns).
6. Group lines into blocks by vertical gap relative to the page's typical leading.
7. Filter page furniture: the same text at the same y-band across three or more pages is a footer, unless it is heading-shaped; a sidebar label that recurs on every resume page is content, and the corpus's real furniture is never heading-shaped.
8. Classify headings by three signals: ALL-CAPS short line first (this fixture's headings match body size, so a size heuristic alone finds zero), font-size jump second, and a font-run signal third: a short capital-starting line in a minority font of a prose-dominated column stream is a subheading (the resume project labels and the registration page's license labels are bold at body size, invisible to the other two signals). Consecutive heading lines merge only when they share a font or are both display-sized: that is what separates a wrapped cover title from a section head welded to its first subhead.
9. Sections are heading-to-heading spans, and every block belongs to one. That is what makes edits section-aware, from the confirmation toast to the eval's target matcher.

**Three planned parser features died by measurement, and one earned its way back.** Before writing parser code I ran pdf.js over all 7 fixtures (118 pages, about 5,100 text items) and derived the pipeline above from what was actually there. A page-3 column patch and a letter-spacing rejoin rule died cleanly: the page is single-column in the text layer, and the letter-spacing artifact never appears in pdf.js output. The generalized column engine died on narrower evidence than I first recorded: my diagnostic note overstated "the primary page I checked is single-column" as corpus-wide absence, the hard-fixture smoke test surfaced the overreach, and the spec carries dated corrections for both the claim and the reversal. The column model was then rebuilt on a branch, measurement-first (channel geometry measured across both layout fixtures before any code), validated against a re-baselined golden set across four declared eval baselines, and merged. The primary fixture's own pages carried the class: its registration page now parses to the designer's actual layout, license labels and all.

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

**Infographic recovery, and page-specific tuning generally.** The column model made the cut line move, so here is where it sits now. What got built is class-level: channel detection with measured thresholds that generalizes across both layout fixtures and leaves single-column documents untouched by construction. What stays cut is everything file-shaped: the staff capacity chart parses as name headings over bare percentages with roles shifted by one, because it is a designed infographic whose row anchors are photos and rings the text layer does not carry. Recovering it means row-region detection, not thresholds, and hardcoding for one difficult page the reviewers happen to hold is designing for the file, not the class. Also still cut: region-scoped channels (one page mixes a full-width intro with a three-column table region and keeps a documented split-sentence limit because of it) and the font-run heading signal outside column streams (document-wide it shatters cover typography into sections; measured, reverted, logged).

**A database.** Answered above by their own brief.

**Multi-paragraph chat.** The hardest stretch goal and the weakest value per hour at this scope. I felt this cut twice during persona testing (a document-wide city swap means re-issuing the edit block by block), and that experience is the v2 argument: region-scoped instructions composing the same per-block primitive, one reviewed diff per touched block, audit trail intact.

**The rest of the product category.** Go/no-go scoring, compliance matrices, CRM sync: known scope-creep hazards, not built.

**Rate limiting on the edit endpoint, documented instead of half-built.** Real limiting on serverless needs shared state, a dependency this scope does not justify. Input caps (file size, page count, instruction and block length) are the v1 mitigation. This is the first thing to add before a paying customer touches the URL.

## Failure modes I worried about

**Found and defused: the Vercel body limit.** Described under design decisions; the reason parsing is client-side.

**Parse failures are enumerated, never silent.** Scanned (no text layer), corrupt, password-protected, and parsed-but-zero-editable-blocks each produce a distinct message. A silent empty render is impossible by construction, and the error states were tested by inducing each failure, not by assuming.

**Extraction artifacts are the terrain, not edge cases.** Layered Canva text stacks duplicates ("Thank You" three times on one line), words fragment mid-token, small-caps type extracts as the casing the designer actually typed (an officer's name arrives lowercase because the small-caps font was hiding a real typo). The parser fixes what measurement justified and leaves casing alone: a parser that guesses casing silently rewrites names like McDonald.

**The layout-heavy fixture now parses structurally, and its remaining boundary is sharper than "it looks bad."** hard.pdf (19 pages, 179 blocks) went from interleaved wreckage to readable structure across the column work: resume pages parse as name banner, a clean single-paragraph bio, per-project subheadings, and the sidebar intact with its labels. What remains degraded is the honest boundary: the staff capacity chart misattributes roles by one (each role line welds to the next person's name), and that failure mode matters more than ugliness because a shifted label reads plausibly while asserting something the document never said, and it arrives upstream of the reviewed diff, the one control that cannot see it. It is also a measured either/or with the current signals, not an oversight: the merge rule that welds those roles is the same display-size allowance that keeps the primary fixture's mixed-font cover title as one heading instead of four sections, and when both sides were measured, the cover won. Separating them takes a new signal (per-person row bands inferred from text rhythm, since the true row anchors are photos and rings the text layer does not carry), which is why infographic row-region detection is on the roadmap rather than patched by threshold. A services matrix still shatters into orphan sections, and list structure is not recovered: the block model has heading and paragraph kinds only, so bullet lists render as run-on prose. The class rule held on an out-of-corpus test too: a synthetic single-column proposal generated from scratch parsed cleanly on first contact, headings caught by the size fallback built for exactly that case.

**Grounding can mis-ground, and the reviewed diff is the control.** Found during persona testing: on the surveying-license block, the vague instruction "update license" produced a proposal that overwrote it with the firm's engineering license (a different license number and officer), because keyword retrieval matched "license" to the wrong entity's boilerplate and the grounding rule handed the model plausible facts. Not fabrication: every token traced back to the knowledge base. Every link behaved as designed and the composition was still wrong, which is exactly why no edit applies without a human-reviewed diff; the wrong license number showed up in red and got rejected on sight. The v2 fix is an entity-consistency guard (reference identifiers never replace in-block identifiers) plus a retrieval relevance threshold.

**Block-scoped edits can strand collateral facts.** Swap the client city in one block and a "55 miles from" claim elsewhere in the paragraph may quietly stop being true; clean extraction debris out of a block and a name that existed nowhere else leaves the document entirely. The diff shows every change honestly, but nothing yet checks document-level consistency after an apply. That check is the v2 review pass.

**One eval case flaps, and it is reported, not tuned away.** See the next section.

**Before a paying customer:** rate limiting and abuse protection on the edit endpoint, monitoring beyond per-edit structured logs, and a written retention statement. The current facts are good ones: the file never leaves the browser, only selected block text goes to the model, nothing is retained server-side, and logs carry latency, tokens, and outcome but never content.

## How I'd evaluate this (and how I did)

The eval is a golden set of 15 labeled edit cases against the shared fixture, run through the live `/api/edit` route with the app's own parser, scored by deterministic string checks. No LLM judge: exact checks are reproducible, free, and defensible line by line. The set has a history that taught me something: it began at 15, grew to 16 when I red-teamed my own set and added a case, and returned to 15 when the column-detection work made one case obsolete, because the extraction defect it existed to repair no longer exists. Two metrics, chosen to mirror the failure classes that matter in this product:

- **Edit faithfulness**: did the edit do what was asked and nothing else (change proposed or correctly refused, required strings present, forbidden strings absent, length within bounds).
- **Name fidelity**: entities (names, cities, PE license numbers) preserved, removed, or added exactly as instructed.

The cases are built from the corpus's real defects: a small-caps casing fix, a phone number extracted into the middle of a pull quote, a real date inconsistency between the cover and the letter, and an adversarial instruction that mentions another section. One case I added after red-teaming my own set: renew both corporate license expirations, where the trap is changing the adjacent license number too (it passed, changed ratio 0.06, only the year moved).

The golden set is also where the true cost of a parser change shows up, so I am reporting it rather than hiding it. Merging the column work forced a re-baseline: one case retired (its target defect is now fixed upstream), and four case coordinates or expectations re-authored because targets and entity checks are bound to the parse they were written against. Every re-author is logged. That tax is exactly why the parser was frozen while the eval was built, and why the column work happened on a branch against a re-baselined copy of the set, behind four declared-before-run baselines, before any of it touched main.

The pre-merge headline, measured on the deployed app through the provided proxy: **14/15 faithfulness, 15/15 name fidelity, p50 2.8s, about $0.06 per full run, about $0.004 per edit.** The post-merge headline on the same deployed path, declared final before it ran: **15/15 faithfulness, 15/15 name fidelity, p50 2.4s, $0.056 per run.** One honesty note on that clean sheet: across all runs the system's profile is 14 to 15 out of 15 with a stochastic length-control flap that moves between cases, and the profile is the number I quote, not the best run. The flap is diagnosed (occasional verbatim return on trivial edits, surfacing as the designed no-change state), and I did not tune the prompt to chase it, because that is training on the test set.

What the numbers hide is more useful than the numbers:

- The baseline run's failure is the whole story of the system prompt. Asked to give an engineer a "newer-looking" PE license number, the untuned model fabricated one (MO PE No. PE-2021000147). Credential fabrication on request, on a government proposal, is the catastrophic failure class. The anti-fabrication rule fixed it, then over-refused legitimate edits, then a scope rule recovered those. Three runs, receipts kept for each.
- The one recurring miss is a flap, diagnosed: on trivial edits the model occasionally returns the input verbatim, surfacing as the designed "no change proposed" state, and one run in the twenties missed a length ceiling instead. It moves between cases across runs; the aggregate profile holds at 14 to 15 of 15 across every baseline on both parser generations.
- Deterministic checks trade recall for precision, and I know where the boundary is: a rewrite that renders "13 engineers" as "thirteen engineers" passes a human read and fails a substring check. That boundary is where an LLM-judge column would add value.

Model pricing was verified against the provider's published rates during the eval (Sonnet 5 at the current intro rate; Haiku 4.5 for the comparison run). Cost per edit is logged per call from real token counts, never estimated.

In production, knowing it still works well is the same two metrics plus the live signals the logs already carry: the golden set runs as a scheduled regression against the deployed route, and per-edit structured logs track latency, token spend, refusal rate, and no-change rate. The one metric only real users can produce is the apply/reject ratio: users rejecting a rising share of proposals is the earliest honest signal that edit quality regressed, and it requires logging nothing but the outcome the app already knows.

## What I added beyond the brief and why

**Knowledge-base grounding.** The five past proposals are ingested by the same parser, indexed, and retrieved per edit; factual additions ground in real past work, and the same excerpts double as register references so added sentences read like the firm wrote them. During persona testing, "add a sentence noting MECO's wastewater treatment work" produced a sentence about a named town's treatment plant upgrade with a concrete clarifier structure, traceable near-verbatim to one source chunk. The same pipeline's measured limits (the vocabulary-mismatch miss, the mis-grounding case) are reported above rather than sanded off.

**DOCX export.** Consultants finish in Word, per the team's own words. The export builds a Word document from the parsed structure with the edit log folded in, headings mapped to Word heading styles. Client-side, lazy-loaded, verified by opening the output in Word itself.

**Production posture on a public URL wired to a real token.** Input caps at every entry point, enumerated failure states with retry, a concurrent-edit guard, output validation before anything renders, env validation that fails fast, an error boundary around the document view, and structured per-edit logs with no content in them. CI runs typecheck, lint, and the parser and eval-metric tests on every push.

**Interaction details.** Streaming proposals, section-aware apply confirmations, keyboard path (instruction box focuses on select, Enter applies a focused proposal, Escape rejects or cancels), refusal messages that coach the retry, history with undo that survives refresh, and a clear-history control that names its consequence before acting.

**Layout recovery for the two-column class.** Three parser features built measurement-first the night before submission, on a branch, gated by a re-baselined golden set across four declared eval baselines, then merged: whitespace-channel column detection with column-major reading order, rotated-decoration exclusion, and font-run subheading detection scoped to prose-dominated column streams. The resume pages of the layout-heavy fixture went from mid-sentence interleave to name, bio, project subheadings, and an intact sidebar; the primary fixture's registration page now parses to the designer's actual hierarchy. The costs are reported in the eval section, and the process (including one same-night spec correction and one reverted approach) is the story I would tell about how I change load-bearing code.

## A note on the fixture data

The fixture corpus is a real engineering firm's past proposals, shared for assessment. Shared for assessment is not permission to republish on public GitHub, so the PDFs, the parsed knowledge-base index, the golden-set cases (which quote them), and all eval reports live outside the repo; the index reaches the deployed app through private Vercel Blob storage read server-side at runtime. The repo carries the machinery: parser, ingest script, retrieval, eval harness, schema, and a synthetic example case.

## What I'd build next given another 8 hours

In priority order, each continuing something the current build already measures or feels:

1. **Multi-section chat.** Region- or document-scoped instructions that compose the existing per-block primitive: one reviewed diff per touched block, apply-all with per-block reject, audit trail unchanged. Felt twice during persona testing; the primitive is already shaped for it.
2. **A post-edit consistency pass.** After an apply, check the document for stranded collateral facts and last-occurrence removals, and suggest follow-up edits. The eval already has the cases that would grade it.
3. **Region-scoped channels and infographic row-regions.** The two named parser boundaries left after the column work: the page that mixes full-width prose with a three-column table region, and the capacity chart whose role labels shift by one person. The second is the sharper problem, because it misattributes rather than garbles.
4. **Grounding guards.** Entity-consistency between block and retrieved references, a retrieval relevance threshold, and the mis-grounding case added to the golden set as a known-failing regression target.
5. **Selective undo.** The append-only log already supports reverting any edit whose block has no later edits; conflicts prompt instead of guessing.
6. **A list block kind, and the font signal generalized.** Bullet detection in the parser, list rendering in the app, Word list styles in the export; the font-run heading rule extended beyond column streams once corpus-wide ground truth exists to tune it against (the approach page's bold subheads are the known miss).
7. **Model routing.** Haiku for mechanical single-entity swaps, Sonnet for prose; the eval data that justifies the split already exists.

The endgame for this product shape is a Word add-in, which is where the customers already live.
