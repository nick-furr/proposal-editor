import { diffWords } from "diff";

// The deterministic tier of the post-edit consistency pass: the eval's
// name-fidelity primitive (does this text still contain that entity) pointed
// at the live document. Lexical recall here, model precision in the judge
// route; over-flagging is acceptable, silent misses are not.

export type ConsistencyHit = { blockId: string; entity: string };

export type ConsistencyScan = {
  // Blocks outside the edit that still mention a removed entity.
  hits: ConsistencyHit[];
  // Name-like entities the edit removed that now appear nowhere at all.
  departed: string[];
};

// The judge route's verdict for one candidate block.
export type ConsistencyFinding = {
  blockId: string;
  stale: boolean;
  reason?: string;
  followUp?: string;
};

// The judge call carries at most this many candidate blocks; the client
// slice and the route validation both import it so they cannot drift.
export const MAX_CANDIDATES = 5;

// One grouping for both the judge request and the card, so the blocks sent
// and the blocks rendered always line up.
export function groupHitsByBlock(hits: ConsistencyHit[]): Map<string, string[]> {
  const byBlock = new Map<string, string[]>();
  for (const hit of hits) {
    byBlock.set(hit.blockId, [...(byBlock.get(hit.blockId) ?? []), hit.entity]);
  }
  return byBlock;
}

// Parse the judge route's model reply. The model speaks JSON here, not
// prose; anything unparseable returns null and the caller falls back to the
// deterministic tier. An item keyed to an unknown block is skipped rather
// than failing the batch: one stray element the model appended must not
// discard every valid verdict.
export function parseFindings(raw: string, candidateIds: Set<string>): ConsistencyFinding[] | null {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const findings: ConsistencyFinding[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) return null;
    const { blockId, stale, reason, followUp } = item as Record<string, unknown>;
    if (typeof blockId !== "string" || typeof stale !== "boolean") return null;
    if (!candidateIds.has(blockId)) continue;
    findings.push({
      blockId,
      stale,
      ...(typeof reason === "string" ? { reason } : {}),
      ...(typeof followUp === "string" ? { followUp } : {}),
    });
  }
  return findings;
}

// Sentence openers pass the capitalization test without naming anything.
const OPENERS = new Set([
  "The", "A", "An", "This", "That", "These", "Those", "We", "Our", "It",
  "In", "On", "At", "For", "With", "As", "To", "And", "But", "Or", "If",
  "When", "While", "Since", "After", "Before", "Both", "Each", "All",
]);

const isEntityToken = (t: string) => /\d/.test(t) || /^[A-Z]/.test(t);

const trimPunct = (t: string) => t.replace(/^[("'[]+/, "").replace(/[.,;:!?)"'\]]+$/, "");

// Maximal runs of capitalized or numeric tokens, minus lone sentence openers.
// Trailing sentence punctuation closes a run, so "Dana Whitfield, President;"
// yields two entities, not one welded name-and-title.
function entityRuns(text: string): string[] {
  const runs: string[] = [];
  let run: string[] = [];
  const close = () => {
    if (run.length > 0) runs.push(run.join(" "));
    run = [];
  };
  for (const raw of text.split(/\s+/)) {
    const token = trimPunct(raw);
    if (token && isEntityToken(token)) {
      run.push(token);
      if (/[.,;:!?]["')\]]*$/.test(raw)) close();
    } else {
      close();
    }
  }
  close();
  return runs.filter((r) => !OPENERS.has(r));
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const entityPattern = (entity: string) => new RegExp(`(^|\\W)${escapeRegExp(entity)}(\\W|$)`);

export function containsEntity(text: string, entity: string): boolean {
  return entityPattern(entity).test(text);
}

// Guards against a pathological diff flooding the judge call.
const MAX_ENTITIES = 8;

function removedEntities(before: string, after: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of diffWords(before, after)) {
    if (!part.removed) continue;
    for (const entity of entityRuns(part.value)) {
      // Still present in the rewritten block means moved, not removed.
      if (!seen.has(entity) && !containsEntity(after, entity)) {
        seen.add(entity);
        out.push(entity);
      }
    }
  }
  return out.slice(0, MAX_ENTITIES);
}

export function scanDocument(
  before: string,
  after: string,
  editedBlockId: string,
  blockTexts: Record<string, string>,
): ConsistencyScan {
  const entities = removedEntities(before, after);
  // Compiled once per entity, not once per block-entity pair; the scan runs
  // synchronously on every apply against every block in the document.
  const patterns = entities.map((entity) => ({ entity, pattern: entityPattern(entity) }));
  const hits: ConsistencyHit[] = [];
  const found = new Set<string>();
  for (const [blockId, text] of Object.entries(blockTexts)) {
    if (blockId === editedBlockId) continue;
    for (const { entity, pattern } of patterns) {
      if (pattern.test(text)) {
        hits.push({ blockId, entity });
        found.add(entity);
      }
    }
  }
  // Departed keeps multi-word entities only. A lone "55" or "President"
  // leaving the document is noise; a full name leaving is the
  // officer-removal case and the point of the check.
  const departed = entities.filter((e) => !found.has(e) && e.includes(" "));
  return { hits, departed };
}
