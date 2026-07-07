# Eval harness

Golden-set eval for the edit loop. The runner parses the fixture with the same
`lib/parser` the app uses, sends each case through the live `/api/edit` route,
and scores the response with deterministic string checks. No LLM judge: exact
checks are reproducible, free, and defensible line by line.

## Metrics

- **Edit faithfulness**: did the edit do what was asked and nothing else.
  Checks per case: a change was actually proposed (or a refusal, where one is
  expected), required strings present, forbidden strings absent, output length
  within case-specific bounds.
- **Name fidelity**: entity names, cities, and PE license numbers preserved
  verbatim, removed, or added exactly as the instruction requires.

Each case also reports a changed-word ratio (share of original words removed
or replaced, via word diff) as blast-radius context, plus latency, token
counts, and cost.

## Running

```bash
npm run eval -- path/to/cases.json
```

Env: `EVAL_BASE_URL` (default `http://localhost:3000`), `EVAL_PDF` (default
`context/fixtures/proposals/easy.pdf`), `EVAL_LABEL` (report name). Reports
land in gitignored `context/eval-reports/`.

## Why the real cases are not in this repo

The golden set quotes text and names real people from the MECO fixture
corpus, which was shared for assessment, not for republishing on public
GitHub. The cases live in gitignored `context/eval-cases/`; this directory
carries the schema (`types.ts`), the scoring logic and its tests, and
`example-cases.json` showing the case shape with placeholder values. Aggregate
results and methodology are reported in the main README.
