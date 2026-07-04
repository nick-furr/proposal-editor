"use client";

import { applyEvents, lastUndoableEvent, undoneEventIds } from "@/lib/editLog";
import type { EditEvent } from "@/lib/types";

export function HistorySidebar({
  events,
  onUndo,
}: {
  events: EditEvent[];
  onUndo: (targetEventId: string) => void;
}) {
  const applied = applyEvents(events);
  if (applied.length === 0) {
    return <p className="text-xs text-muted">Applied edits appear here.</p>;
  }
  const undone = undoneEventIds(events);
  const undoable = lastUndoableEvent(events);

  return (
    <div className="space-y-2">
      {[...applied].reverse().map((event) => {
        const isUndone = undone.has(event.id);
        return (
          <div
            key={event.id}
            className={`rounded-lg border border-edge p-3 text-xs ${isUndone ? "opacity-50" : ""}`}
          >
            <p className={isUndone ? "line-through" : ""}>{event.instruction}</p>
            <p className="mt-1 text-muted">
              {event.sectionTitle ?? "Untitled section"} at{" "}
              {new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {isUndone && ", undone"}
            </p>
            {undoable?.id === event.id && (
              <button
                type="button"
                onClick={() => onUndo(event.id)}
                className="mt-2 rounded-md border border-edge px-2 py-1 text-muted transition-colors hover:text-foreground"
              >
                Undo
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
