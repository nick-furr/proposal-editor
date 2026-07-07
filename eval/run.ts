// Golden-set runner. Parses the fixture with the same lib/parser the app
// uses, sends each case through the deployed edit route, scores the response
// with deterministic checks, and writes a full report to gitignored
// context/eval-reports/. Usage:
//
//   npm run eval [-- path/to/cases.json]
//
// Env: EVAL_BASE_URL (default http://localhost:3000), EVAL_PDF (default
// context/fixtures/proposals/easy.pdf), EVAL_LABEL (report file name).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parsePages } from "../lib/parser/parser";
import type { Block, Section } from "../lib/types";
import { extractPdfPages } from "./extract-node";
import { allPass, scoreCase } from "./metrics";
import type { CaseScore, EvalCase } from "./types";

// USD per million tokens, checked against platform.claude.com on 2026-07-06.
// Sonnet 5 is on intro pricing (list 3/15) through 2026-08-31.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

type EditResponse = {
  text: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

type CaseResult = {
  evalCase: EvalCase;
  blockText: string;
  response: EditResponse | { error: string };
  score: CaseScore | null;
};

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function findBlock(
  sections: Section[],
  blocks: Record<string, Block>,
  target: EvalCase["target"],
): { block: Block; sectionTitle: string | null } {
  const inSections = sections.filter((s) =>
    target.section === null ? s.title === null : normalize(s.title ?? "") === normalize(target.section),
  );
  if (inSections.length === 0) {
    throw new Error(`no section matching ${JSON.stringify(target.section)}`);
  }
  const prefix = normalize(target.textPrefix);
  const matches = inSections.flatMap((s) =>
    s.blockIds
      .map((id) => blocks[id])
      .filter((b) => b.kind === "paragraph" && normalize(b.text).startsWith(prefix))
      .map((b) => ({ block: b, sectionTitle: s.title })),
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly 1 block starting with "${target.textPrefix}", found ${matches.length}`,
    );
  }
  return matches[0];
}

async function callEdit(
  baseUrl: string,
  blockText: string,
  instruction: string,
  sectionTitle: string | null,
): Promise<EditResponse> {
  const res = await fetch(`${baseUrl}/api/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      blockText,
      instruction,
      ...(sectionTitle ? { sectionTitle } : {}),
      mode: "json",
    }),
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      code = `${code}:${((await res.json()) as { error?: string }).error ?? ""}`;
    } catch {
      // body was not JSON; the status code alone identifies the failure
    }
    throw new Error(code);
  }
  return (await res.json()) as EditResponse;
}

function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const rate = PRICING[model];
  if (!rate) return null;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1e6;
}

function reportMarkdown(results: CaseResult[], label: string, baseUrl: string): string {
  const lines: string[] = [`# Eval run: ${label}`, "", `Base URL: ${baseUrl}`, `Date: ${new Date().toISOString()}`, ""];
  const scored = results.filter((r) => r.score !== null);
  const faithPass = scored.filter((r) => allPass(r.score!.faithfulness)).length;
  const namePass = scored.filter((r) => allPass(r.score!.nameFidelity)).length;
  const ok = results.filter((r) => "text" in r.response) as (CaseResult & { response: EditResponse })[];
  const latencies = ok.map((r) => r.response.latencyMs).sort((a, b) => a - b);
  const inTok = ok.reduce((n, r) => n + r.response.inputTokens, 0);
  const outTok = ok.reduce((n, r) => n + r.response.outputTokens, 0);
  const model = ok[0]?.response.model ?? "unknown";
  const cost = costUsd(model, inTok, outTok);

  lines.push("## Aggregate", "");
  lines.push(`- Model: ${model}`);
  lines.push(`- Cases: ${results.length} (${results.length - scored.length} errored)`);
  lines.push(`- Edit faithfulness: ${faithPass}/${scored.length}`);
  lines.push(`- Name fidelity: ${namePass}/${scored.length}`);
  if (latencies.length > 0) {
    lines.push(`- Latency p50: ${latencies[Math.floor(latencies.length / 2)]}ms, max: ${latencies[latencies.length - 1]}ms`);
  }
  lines.push(`- Tokens: ${inTok} in / ${outTok} out`);
  lines.push(`- Cost: ${cost === null ? `unknown model rate` : `$${cost.toFixed(4)}`}`);
  lines.push("", "## Cases", "");

  for (const r of results) {
    lines.push(`### ${r.evalCase.id} (${r.evalCase.category})`, "");
    lines.push(`Instruction: ${r.evalCase.instruction}`, "");
    if ("error" in r.response) {
      lines.push(`FAILED: ${r.response.error}`, "");
      continue;
    }
    const s = r.score!;
    const flag = (checks: { name: string; pass: boolean }[]) =>
      checks.map((c) => `${c.pass ? "PASS" : "FAIL"} ${c.name}`).join("; ");
    lines.push(`- Faithfulness: ${flag(s.faithfulness)}`);
    lines.push(`- Name fidelity: ${s.nameFidelity.length > 0 ? flag(s.nameFidelity) : "n/a"}`);
    lines.push(`- Changed ratio: ${s.changedRatio.toFixed(2)}, latency: ${r.response.latencyMs}ms, tokens: ${r.response.inputTokens}/${r.response.outputTokens}`);
    lines.push("", "Before:", "```", r.blockText, "```", "After:", "```", r.response.text, "```", "");
  }
  return lines.join("\n");
}

async function main() {
  const casesPath = process.argv[2] ?? "context/eval-cases/cases.json";
  const pdfPath = process.env.EVAL_PDF ?? "context/fixtures/proposals/easy.pdf";
  const baseUrl = (process.env.EVAL_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const label = process.env.EVAL_LABEL ?? new Date().toISOString().replace(/[:.]/g, "-");

  const cases = JSON.parse(readFileSync(casesPath, "utf8")) as EvalCase[];
  const pages = await extractPdfPages(pdfPath);
  const doc = parsePages(pages, { fileHash: "eval", fileName: basename(pdfPath) });
  console.log(`${basename(pdfPath)}: ${Object.keys(doc.blocks).length} blocks, ${doc.sections.length} sections, ${cases.length} cases -> ${baseUrl}`);

  const results: CaseResult[] = [];
  for (const evalCase of cases) {
    const { block, sectionTitle } = findBlock(doc.sections, doc.blocks, evalCase.target);
    process.stdout.write(`${evalCase.id} ... `);
    try {
      const response = await callEdit(baseUrl, block.text, evalCase.instruction, sectionTitle);
      const score = scoreCase(evalCase.expect, block.text, response.text);
      const f = allPass(score.faithfulness) ? "F:pass" : "F:FAIL";
      const n = score.nameFidelity.length > 0 ? (allPass(score.nameFidelity) ? "N:pass" : "N:FAIL") : "N:n/a";
      console.log(`${f} ${n} ${response.latencyMs}ms`);
      results.push({ evalCase, blockText: block.text, response, score });
    } catch (err) {
      console.log(`ERROR ${err instanceof Error ? err.message : String(err)}`);
      results.push({
        evalCase,
        blockText: block.text,
        response: { error: err instanceof Error ? err.message : String(err) },
        score: null,
      });
    }
  }

  const outDir = "context/eval-reports";
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${label}.md`);
  writeFileSync(outPath, reportMarkdown(results, label, baseUrl));
  writeFileSync(join(outDir, `${label}.json`), JSON.stringify(results, null, 2));
  console.log(`\nreport: ${outPath}`);

  const errored = results.filter((r) => "error" in r.response).length;
  if (errored > 0) {
    console.error(`${errored} case(s) errored; treat this run as invalid.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
