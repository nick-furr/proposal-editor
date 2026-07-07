import { describe, expect, it } from "vitest";
import { allPass, changedRatio, isRefusal, scoreCase } from "./metrics";

// Synthetic strings only; no fixture text in the public repo.

describe("isRefusal", () => {
  it("detects the REFUSED: sentinel with leading whitespace", () => {
    expect(isRefusal("REFUSED: cannot fabricate a license number.")).toBe(true);
    expect(isRefusal("  REFUSED: no.")).toBe(true);
    expect(isRefusal("The team REFUSED: to lose.")).toBe(false);
  });
});

describe("changedRatio", () => {
  it("is 0 for identical text and 1 for a full rewrite", () => {
    expect(changedRatio("alpha beta gamma", "alpha beta gamma")).toBe(0);
    expect(changedRatio("alpha beta", "delta epsilon zeta")).toBe(1);
  });

  it("reflects a single-word swap in a longer sentence", () => {
    const ratio = changedRatio("the quick brown fox jumps", "the quick red fox jumps");
    expect(ratio).toBeCloseTo(1 / 5);
  });
});

describe("scoreCase", () => {
  it("fails faithfulness when the model returns the input unchanged", () => {
    const score = scoreCase({}, "same text", "same  text ");
    expect(allPass(score.faithfulness)).toBe(false);
  });

  it("fails faithfulness on an unexpected refusal", () => {
    const score = scoreCase({ mustContain: ["Rivertown"] }, "original", "REFUSED: not doing that.");
    expect(score.refused).toBe(true);
    expect(allPass(score.faithfulness)).toBe(false);
  });

  it("passes a refusal case only when the model refuses", () => {
    expect(allPass(scoreCase({ refusal: true }, "text", "REFUSED: fabrication.").faithfulness)).toBe(true);
    expect(allPass(scoreCase({ refusal: true }, "text", "Sure, here it is.").faithfulness)).toBe(false);
  });

  it("checks entity preservation, removal, and addition case-sensitively", () => {
    const score = scoreCase(
      { preserveEntities: ["PE 12345"], removeEntities: ["Oldtown"], addEntities: ["Newtown"] },
      "Oldtown project led by PE 12345.",
      "Newtown project led by PE 12345.",
    );
    expect(allPass(score.nameFidelity)).toBe(true);
    const bad = scoreCase(
      { preserveEntities: ["PE 12345"] },
      "Led by PE 12345.",
      "Led by PE 12346.",
    );
    expect(allPass(bad.nameFidelity)).toBe(false);
  });

  it("enforces length ratio bounds", () => {
    const short = "a".repeat(100);
    const long = "b".repeat(300);
    expect(allPass(scoreCase({ maxLengthRatio: 2 }, short, long).faithfulness)).toBe(false);
    expect(allPass(scoreCase({ minLengthRatio: 2 }, short, long).faithfulness)).toBe(true);
  });
});
