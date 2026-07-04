"use client";

import type { ParsedDoc } from "@/lib/types";

function BlockView({
  text,
  selected,
  onSelect,
}: {
  text: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-lg border p-3 text-left text-sm leading-relaxed whitespace-pre-line transition-colors ${
        selected
          ? "border-accent bg-surface ring-1 ring-accent"
          : "border-transparent hover:border-edge hover:bg-surface"
      }`}
    >
      {text}
    </button>
  );
}

export function DocumentView({
  doc,
  blockText,
  selectedBlockId,
  onSelect,
}: {
  doc: ParsedDoc;
  // Current text per block: parsed text with applied edits folded in.
  blockText: (blockId: string) => string;
  selectedBlockId: string | null;
  onSelect: (blockId: string | null) => void;
}) {
  return (
    <div className="space-y-6">
      {doc.sections.map((section) => (
        <section key={section.id}>
          {section.title && (
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-accent">
              {section.title}
            </h2>
          )}
          <div className="space-y-1">
            {section.blockIds
              .map((id) => doc.blocks[id])
              .filter((block) => block.kind === "paragraph")
              .map((block) => (
                <BlockView
                  key={block.id}
                  text={blockText(block.id)}
                  selected={block.id === selectedBlockId}
                  onSelect={() => onSelect(block.id === selectedBlockId ? null : block.id)}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
