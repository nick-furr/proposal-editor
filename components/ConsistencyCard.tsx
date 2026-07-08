"use client";

import type { ConsistencyFinding, ConsistencyScan } from "@/lib/consistency";

export type ConsistencyStatus = "checking" | "judged" | "unavailable";

// One card per apply. The deterministic hits render immediately; the model
// verdicts fill in when the judge call returns, or never, and the card still
// stands on the lexical matches alone.
const SNIPPET_CHARS = 90;

export function ConsistencyCard({
  scan,
  status,
  findings,
  blockLabel,
  blockText,
  onFollowUp,
  onDismiss,
}: {
  scan: ConsistencyScan;
  status: ConsistencyStatus;
  findings: ConsistencyFinding[];
  blockLabel: (blockId: string) => string;
  blockText: (blockId: string) => string;
  onFollowUp: (blockId: string, instruction: string) => void;
  onDismiss: () => void;
}) {
  const byBlock = new Map<string, string[]>();
  for (const hit of scan.hits) {
    byBlock.set(hit.blockId, [...(byBlock.get(hit.blockId) ?? []), hit.entity]);
  }
  const findingFor = (blockId: string) => findings.find((f) => f.blockId === blockId);

  return (
    <div className="mt-6 space-y-3 rounded-lg border border-edge bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Consistency check</h2>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-muted transition-colors hover:text-foreground"
        >
          Dismiss
        </button>
      </div>

      {scan.departed.length > 0 && (
        <p className="text-xs text-muted">
          Removed from the document entirely:{" "}
          <span className="text-foreground">{scan.departed.join(", ")}</span>
        </p>
      )}

      {[...byBlock.entries()].map(([blockId, entities]) => {
        const finding = findingFor(blockId);
        const text = blockText(blockId);
        return (
          <div key={blockId} className="space-y-1 border-t border-edge pt-2 text-xs">
            <p>
              <span className="font-medium">{blockLabel(blockId)}</span>{" "}
              <span className="text-muted">still mentions {entities.join(", ")}</span>
            </p>
            {/* Several findings can share a section label; the block's own
                words are what tell them apart, judge or no judge. */}
            <p className="italic text-muted">
              {text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS)}...` : text}
            </p>
            {status === "checking" && <p className="animate-pulse text-muted">Checking</p>}
            {status === "unavailable" && (
              <p className="text-muted">Model check unavailable; text match only.</p>
            )}
            {finding && !finding.stale && <p className="text-muted">Reads as consistent.</p>}
            {finding?.stale && (
              <>
                {finding.reason && <p className="text-removed">{finding.reason}</p>}
                {finding.followUp && (
                  <button
                    type="button"
                    onClick={() => onFollowUp(blockId, finding.followUp!)}
                    className="rounded-md border border-edge px-2 py-1 text-muted transition-colors hover:text-foreground"
                  >
                    Fix this block
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
