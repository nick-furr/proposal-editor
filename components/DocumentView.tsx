"use client";

import type { ParsedDoc } from "@/lib/types";

function BlockView({
  text,
  selected,
  streaming,
  edited,
  onSelect,
}: {
  text: string;
  selected: boolean;
  streaming: boolean;
  edited: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative w-full rounded-lg border p-3 text-left text-sm leading-relaxed whitespace-pre-line transition-colors ${
        selected
          ? "border-accent bg-surface ring-1 ring-accent"
          : "border-transparent hover:border-edge hover:bg-surface"
      } ${streaming ? "opacity-60" : ""}`}
    >
      {edited && (
        <span className="absolute right-2 top-2 rounded bg-added/15 px-1.5 text-[10px] text-added">
          edited
        </span>
      )}
      {text}
    </button>
  );
}

export function DocumentView({
  doc,
  blockText,
  selectedBlockId,
  streamingBlockId,
  editedBlockIds,
  onSelect,
}: {
  doc: ParsedDoc;
  // Current text per block: parsed text with applied edits folded in.
  blockText: (blockId: string) => string;
  selectedBlockId: string | null;
  streamingBlockId: string | null;
  editedBlockIds: Set<string>;
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
                  streaming={block.id === streamingBlockId}
                  edited={editedBlockIds.has(block.id)}
                  onSelect={() => onSelect(block.id === selectedBlockId ? null : block.id)}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
