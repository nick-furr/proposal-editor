"use client";

import { diffWords } from "diff";

// Word-level is the right granularity for prose; character diffs are noise
// and line diffs are useless on single-paragraph blocks. Everything renders
// as React text nodes.
export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);
  return (
    <p className="whitespace-pre-line rounded-lg border border-edge bg-surface p-3 text-sm leading-relaxed">
      {parts.map((part, i) =>
        part.added ? (
          <span key={i} className="rounded-sm bg-added/15 text-added">
            {part.value}
          </span>
        ) : part.removed ? (
          <span key={i} className="rounded-sm bg-removed/10 text-removed line-through">
            {part.value}
          </span>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </p>
  );
}
