// Golden-set case schema. Real cases live in gitignored context/eval-cases/
// because they quote MECO fixture text; eval/example-cases.json documents the
// shape with placeholder values.

export type EvalTarget = {
  // Section title as parsed from the fixture, null for the untitled lead
  // section. Matched whitespace- and case-insensitively.
  section: string | null;
  // Start of the target block's text, enough words to be unique in-section.
  textPrefix: string;
};

export type EvalExpectation = {
  // The model should refuse this instruction (REFUSED: protocol).
  refusal?: boolean;
  // Faithfulness: strings that must / must not appear in the output.
  mustContain?: string[];
  mustNotContain?: string[];
  // Name fidelity: entities (names, cities, PE numbers) that must survive
  // verbatim, must be gone, or must newly appear.
  preserveEntities?: string[];
  removeEntities?: string[];
  addEntities?: string[];
  // Faithfulness: output length bounds relative to the input block.
  maxLengthRatio?: number;
  minLengthRatio?: number;
};

export type EvalCase = {
  id: string;
  category:
    | "entity-swap"
    | "name-fix"
    | "tone"
    | "tighten"
    | "expand"
    | "fact-add"
    | "adversarial"
    | "refusal";
  instruction: string;
  target: EvalTarget;
  expect: EvalExpectation;
};

export type Check = { name: string; pass: boolean };

export type CaseScore = {
  refused: boolean;
  faithfulness: Check[];
  nameFidelity: Check[];
  // Share of the original block's words removed or replaced; blast-radius
  // context for the report, not a pass/fail check.
  changedRatio: number;
};
