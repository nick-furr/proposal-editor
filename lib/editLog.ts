import type { ApplyEvent, EditEvent, ParsedDoc } from "./types";

// The edit history is an append-only event log. Undo appends an undo event
// instead of popping, so the whole history stays serializable and replayable.

export function undoneEventIds(events: EditEvent[]): Set<string> {
  return new Set(events.flatMap((event) => (event.type === "undo" ? [event.targetEventId] : [])));
}

// Fold the log over the parsed text to get a block's current content.
export function currentText(doc: ParsedDoc, events: EditEvent[], blockId: string): string {
  const undone = undoneEventIds(events);
  let text = doc.blocks[blockId].text;
  for (const event of events) {
    if (event.type === "apply" && event.blockId === blockId && !undone.has(event.id)) {
      text = event.after;
    }
  }
  return text;
}

export function editedBlockIds(events: EditEvent[]): Set<string> {
  const undone = undoneEventIds(events);
  return new Set(
    events.flatMap((event) =>
      event.type === "apply" && !undone.has(event.id) ? [event.blockId] : [],
    ),
  );
}

export function applyEvents(events: EditEvent[]): ApplyEvent[] {
  return events.filter((event): event is ApplyEvent => event.type === "apply");
}

// Undo targets the most recent apply that has not been undone.
export function lastUndoableEvent(events: EditEvent[]): ApplyEvent | null {
  const undone = undoneEventIds(events);
  const candidates = applyEvents(events).filter((event) => !undone.has(event.id));
  return candidates[candidates.length - 1] ?? null;
}

// Persist the log per document so a refresh does not lose applied edits.
// Version the key with the log shape, not the parser version.
const LOG_VERSION = 1;

const logKey = (fileHash: string) => `edits:v${LOG_VERSION}:${fileHash}`;

export function loadEvents(fileHash: string): EditEvent[] {
  try {
    const raw = localStorage.getItem(logKey(fileHash));
    return raw ? (JSON.parse(raw) as EditEvent[]) : [];
  } catch {
    // Unavailable storage or a corrupted entry means an empty history.
    return [];
  }
}

export function saveEvents(fileHash: string, events: EditEvent[]): void {
  try {
    localStorage.setItem(logKey(fileHash), JSON.stringify(events));
  } catch {
    // Quota or private mode: edits still work for this session.
  }
}
