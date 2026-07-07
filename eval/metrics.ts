import { diffWords } from "diff";
import type { CaseScore, Check, EvalExpectation } from "./types";

// Every check is deterministic string comparison. An LLM judge would mirror
// Buoyant's Review product but adds spend and a second model's judgment to
// defend; exact checks are the stronger artifact under code review.

export function isRefusal(output: string): boolean {
  return output.trimStart().startsWith("REFUSED:");
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

export function changedRatio(before: string, after: string): number {
  let kept = 0;
  let removed = 0;
  for (const part of diffWords(before, after)) {
    const words = part.value.trim().split(/\s+/).filter(Boolean).length;
    if (part.removed) removed += words;
    else if (!part.added) kept += words;
  }
  const total = kept + removed;
  return total === 0 ? 0 : removed / total;
}

export function allPass(checks: Check[]): boolean {
  return checks.every((c) => c.pass);
}

export function scoreCase(expect: EvalExpectation, before: string, after: string): CaseScore {
  const refused = isRefusal(after);
  const faithfulness: Check[] = [];
  const nameFidelity: Check[] = [];

  if (expect.refusal) {
    faithfulness.push({ name: "refuses", pass: refused });
  } else {
    faithfulness.push({
      name: "proposes a change",
      pass: !refused && normalize(after) !== normalize(before),
    });
  }
  for (const s of expect.mustContain ?? []) {
    faithfulness.push({ name: `contains "${s}"`, pass: after.includes(s) });
  }
  for (const s of expect.mustNotContain ?? []) {
    faithfulness.push({ name: `omits "${s}"`, pass: !after.includes(s) });
  }
  const ratio = before.length === 0 ? 0 : after.length / before.length;
  if (expect.maxLengthRatio !== undefined) {
    faithfulness.push({
      name: `length <= ${expect.maxLengthRatio}x`,
      pass: ratio <= expect.maxLengthRatio,
    });
  }
  if (expect.minLengthRatio !== undefined) {
    faithfulness.push({
      name: `length >= ${expect.minLengthRatio}x`,
      pass: ratio >= expect.minLengthRatio,
    });
  }

  for (const e of expect.preserveEntities ?? []) {
    nameFidelity.push({ name: `preserves "${e}"`, pass: after.includes(e) });
  }
  for (const e of expect.removeEntities ?? []) {
    nameFidelity.push({ name: `removes "${e}"`, pass: !after.includes(e) });
  }
  for (const e of expect.addEntities ?? []) {
    nameFidelity.push({ name: `adds "${e}"`, pass: after.includes(e) });
  }

  return { refused, faithfulness, nameFidelity, changedRatio: changedRatio(before, after) };
}
