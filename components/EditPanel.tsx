"use client";

import { useEffect, useState } from "react";
import { MAX_INSTRUCTION_CHARS } from "@/lib/limits";
import { DiffView } from "./DiffView";

export type EditState =
  | { status: "streaming"; blockId: string; baseText: string; instruction: string; sectionTitle: string | null; proposal: string }
  | { status: "proposed"; blockId: string; baseText: string; instruction: string; sectionTitle: string | null; proposal: string }
  | { status: "no_change"; blockId: string; instruction: string; sectionTitle: string | null }
  | { status: "refused"; blockId: string; reason: string }
  | { status: "error"; blockId: string; baseText: string; instruction: string; sectionTitle: string | null; code: string };

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "The model service is rate limiting requests. Wait a moment and retry.",
  auth: "The model service rejected the credentials. The key may be wrong or a spend cap was hit.",
  network: "Could not reach the model service.",
  upstream: "The model service returned an error.",
  config: "The server is missing its API configuration.",
  stale: "This block changed after the proposal was made. Propose the edit again.",
};

function ActionButton({
  onClick,
  children,
  primary = false,
  autoFocus = false,
}: {
  onClick: () => void;
  children: string;
  primary?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
        primary
          ? "bg-accent font-medium text-background hover:opacity-90"
          : "border border-edge text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function EditPanel({
  blockText,
  edit,
  onPropose,
  onApply,
  onReject,
  onRetry,
  onDismiss,
}: {
  blockText: string;
  edit: EditState | null;
  onPropose: (instruction: string) => void;
  onApply: () => void;
  onReject: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const overCap = instruction.length > MAX_INSTRUCTION_CHARS;

  // Keyboard path for the loop: Escape rejects a proposal or cancels a
  // stream. Apply takes focus when the diff appears, so Enter applies.
  const status = edit?.status;
  useEffect(() => {
    if (status !== "proposed" && status !== "streaming") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (status === "proposed") onReject();
      else onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, onReject, onDismiss]);

  if (edit === null) {
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Refine this block</h2>
        <p className="max-h-40 overflow-y-auto whitespace-pre-line rounded-lg border border-edge p-3 text-xs text-muted">
          {blockText}
        </p>
        <textarea
          value={instruction}
          autoFocus
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Describe the change, for example: make this more direct, or: the new mayor is Jane Smith, update the greeting"
          rows={3}
          className="w-full resize-none rounded-lg border border-edge bg-surface p-3 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <div className="flex items-center justify-between">
          <span className={`text-xs ${overCap ? "text-removed" : "text-muted"}`}>
            {instruction.length}/{MAX_INSTRUCTION_CHARS}
          </span>
          <ActionButton
            primary
            onClick={() => {
              const trimmed = instruction.trim();
              if (trimmed.length > 0 && !overCap) onPropose(trimmed);
            }}
          >
            Propose edit
          </ActionButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {"instruction" in edit && (
        <p className="text-xs text-muted">
          Instruction: <span className="text-foreground">{edit.instruction}</span>
        </p>
      )}

      {edit.status === "streaming" && (
        <>
          <p className="whitespace-pre-line rounded-lg border border-edge bg-surface p-3 text-sm leading-relaxed">
            {edit.proposal}
            <span className="animate-pulse text-accent">▌</span>
          </p>
          <ActionButton onClick={onDismiss}>Cancel</ActionButton>
        </>
      )}

      {edit.status === "proposed" && (
        <>
          <DiffView before={edit.baseText} after={edit.proposal} />
          <div className="flex gap-2">
            <ActionButton primary autoFocus onClick={onApply}>
              Apply
            </ActionButton>
            <ActionButton onClick={onReject}>Reject</ActionButton>
          </div>
        </>
      )}

      {edit.status === "no_change" && (
        <>
          <p className="text-sm text-muted">The model proposed no change to this block.</p>
          <ActionButton onClick={onDismiss}>Close</ActionButton>
        </>
      )}

      {edit.status === "refused" && (
        <>
          <p className="text-sm text-muted">The model declined this edit: {edit.reason}</p>
          <p className="text-xs text-muted">
            Tip: say exactly what should change, and include any new facts (names, addresses,
            dates) in the instruction.
          </p>
          <ActionButton onClick={onDismiss}>Close</ActionButton>
        </>
      )}

      {edit.status === "error" && (
        <>
          <p className="text-sm text-removed">
            {ERROR_MESSAGES[edit.code] ?? "Something went wrong with the edit call."}
          </p>
          <div className="flex gap-2">
            {edit.code !== "stale" && (
              <ActionButton primary onClick={onRetry}>
                Retry
              </ActionButton>
            )}
            <ActionButton onClick={onDismiss}>Close</ActionButton>
          </div>
        </>
      )}
    </div>
  );
}
