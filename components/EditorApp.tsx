"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { groupHitsByBlock, MAX_CANDIDATES, scanDocument, type ConsistencyFinding, type ConsistencyScan } from "@/lib/consistency";
import { MAX_BLOCK_CHARS } from "@/lib/limits";
import { currentText, editedBlockIds, lastUndoableEvent, loadEvents, saveEvents } from "@/lib/editLog";
import { sha256Hex } from "@/lib/hash";
import { cacheParse, getCachedParse } from "@/lib/parseCache";
import { parsePages } from "@/lib/parser/parser";
import type { EditEvent, ParsedDoc } from "@/lib/types";
import { ConsistencyCard, type ConsistencyStatus } from "./ConsistencyCard";
import { DocumentView } from "./DocumentView";
import { EditPanel, type EditState } from "./EditPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { HistorySidebar } from "./HistorySidebar";
import { TopBar } from "./TopBar";
import { UploadScreen, type UploadError } from "./UploadScreen";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

// The current heading text, not the parse-time title: consistency follow-ups
// can edit heading blocks, and every label derived here must say what the
// document says now.
function sectionTitleFor(doc: ParsedDoc, events: EditEvent[], blockId: string): string | null {
  const section = doc.sections.find((s) => s.blockIds.includes(blockId));
  if (!section || section.title === null) return null;
  return currentText(doc, events, section.blockIds[0]);
}

type State =
  | { phase: "idle"; error: UploadError | null }
  | { phase: "parsing"; fileName: string }
  | {
      phase: "ready";
      doc: ParsedDoc;
      fromCache: boolean;
      selectedBlockId: string | null;
      events: EditEvent[];
      edit: EditState | null;
    };

type Action =
  | { type: "parse_started"; fileName: string }
  | { type: "parse_failed"; error: UploadError }
  | { type: "parse_succeeded"; doc: ParsedDoc; fromCache: boolean; events: EditEvent[] }
  | { type: "select_block"; blockId: string | null }
  | { type: "reset" }
  | { type: "edit_started"; blockId: string; baseText: string; instruction: string; sectionTitle: string | null }
  | { type: "proposal_chunk"; text: string }
  | { type: "proposal_done" }
  | { type: "edit_failed"; code: string }
  | { type: "edit_dismissed" }
  // The id is minted at the call site so the consistency card can key its
  // source apply by identity instead of comparing event content.
  | { type: "apply_proposal"; eventId: string }
  | { type: "undo"; targetEventId: string }
  | { type: "clear_history" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "parse_started":
      return { phase: "parsing", fileName: action.fileName };
    case "parse_failed":
      return { phase: "idle", error: action.error };
    case "parse_succeeded":
      return {
        phase: "ready",
        doc: action.doc,
        fromCache: action.fromCache,
        selectedBlockId: null,
        events: action.events,
        edit: null,
      };
    case "reset":
      return { phase: "idle", error: null };
  }

  if (state.phase !== "ready") return state;

  switch (action.type) {
    case "select_block":
      // Changing selection discards any proposal; the caller aborts an
      // in-flight stream before dispatching.
      return { ...state, selectedBlockId: action.blockId, edit: null };
    case "edit_started":
      // One in-flight request at a time, by construction.
      if (state.edit?.status === "streaming") return state;
      return {
        ...state,
        edit: {
          status: "streaming",
          blockId: action.blockId,
          baseText: action.baseText,
          instruction: action.instruction,
          sectionTitle: action.sectionTitle,
          proposal: "",
        },
      };
    case "proposal_chunk":
      if (state.edit?.status !== "streaming") return state;
      return { ...state, edit: { ...state.edit, proposal: state.edit.proposal + action.text } };
    case "proposal_done": {
      if (state.edit?.status !== "streaming") return state;
      const edit = state.edit;
      const proposal = edit.proposal.trim();
      if (proposal.startsWith("REFUSED:")) {
        return {
          ...state,
          edit: {
            status: "refused",
            blockId: edit.blockId,
            reason: proposal.slice("REFUSED:".length).trim(),
          },
        };
      }
      if (proposal.length === 0 || proposal === edit.baseText.trim()) {
        return {
          ...state,
          edit: {
            status: "no_change",
            blockId: edit.blockId,
            instruction: edit.instruction,
            sectionTitle: edit.sectionTitle,
          },
        };
      }
      return { ...state, edit: { ...edit, status: "proposed", proposal } };
    }
    case "edit_failed": {
      if (state.edit?.status !== "streaming") return state;
      const { blockId, baseText, instruction, sectionTitle } = state.edit;
      return {
        ...state,
        edit: { status: "error", blockId, baseText, instruction, sectionTitle, code: action.code },
      };
    }
    case "edit_dismissed":
      return { ...state, edit: null };
    case "apply_proposal": {
      if (state.edit?.status !== "proposed") return state;
      const edit = state.edit;
      // A proposal only applies to the exact text it was made against.
      if (edit.baseText !== currentText(state.doc, state.events, edit.blockId)) {
        return { ...state, edit: { ...edit, status: "error", code: "stale" } };
      }
      const event: EditEvent = {
        id: action.eventId,
        type: "apply",
        blockId: edit.blockId,
        sectionTitle: edit.sectionTitle,
        before: edit.baseText,
        after: edit.proposal,
        instruction: edit.instruction,
        ts: Date.now(),
      };
      return { ...state, events: [...state.events, event], edit: null };
    }
    case "clear_history":
      // Emptying the log also reverts applied edits: currentText folds the
      // events, so no events means the parsed original.
      return { ...state, events: [], edit: null };
    case "undo": {
      // Only the most recent un-undone apply may be undone.
      if (lastUndoableEvent(state.events)?.id !== action.targetEventId) return state;
      const event: EditEvent = {
        id: crypto.randomUUID(),
        type: "undo",
        targetEventId: action.targetEventId,
        ts: Date.now(),
      };
      return { ...state, events: [...state.events, event] };
    }
    default:
      return state;
  }
}

// The apply a card reports on. The eventId keys the card to its apply by
// identity; the payload stays because revalidation excludes the source
// block and a judge refresh resends the original edit.
type ConsistencySource = {
  eventId: string;
  blockId: string;
  before: string;
  after: string;
  instruction: string;
};

type ConsistencyUi = {
  scan: ConsistencyScan;
  status: ConsistencyStatus;
  findings: ConsistencyFinding[];
  source: ConsistencySource;
} | null;

export function EditorApp() {
  const [state, dispatch] = useReducer(reducer, { phase: "idle", error: null });
  const [toast, setToast] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [consistency, setConsistency] = useState<ConsistencyUi>(null);
  // seq forces the edit panel remount when a follow-up targets the block
  // that is already selected; the block id alone would not change the key.
  const [prefill, setPrefill] = useState<{ blockId: string; instruction: string; seq: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const consistencyAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  const fileHash = state.phase === "ready" ? state.doc.fileHash : null;
  const eventsToSave = state.phase === "ready" ? state.events : null;
  useEffect(() => {
    if (fileHash && eventsToSave) saveEvents(fileHash, eventsToSave);
  }, [fileHash, eventsToSave]);

  const handleFile = useCallback(async (file: File) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      dispatch({ type: "parse_failed", error: { kind: "wrong-type" } });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      dispatch({ type: "parse_failed", error: { kind: "too-large" } });
      return;
    }
    dispatch({ type: "parse_started", fileName: file.name });
    try {
      const buffer = await file.arrayBuffer();
      // Hash before extraction: pdf.js transfers the buffer to its worker.
      const hash = await sha256Hex(buffer);
      const cached = getCachedParse(hash);
      if (cached) {
        dispatch({ type: "parse_succeeded", doc: cached, fromCache: true, events: loadEvents(hash) });
        return;
      }
      // pdf.js loads on first use only, and only in the browser.
      const { extractPages } = await import("@/lib/pdf/extract");
      const result = await extractPages(buffer);
      if (!result.ok) {
        dispatch({
          type: "parse_failed",
          error:
            result.reason === "too-many-pages"
              ? { kind: "too-many-pages", pageCount: result.pageCount }
              : { kind: result.reason },
        });
        return;
      }
      const doc = parsePages(result.pages, { fileHash: hash, fileName: file.name });
      if (Object.keys(doc.blocks).length === 0) {
        dispatch({ type: "parse_failed", error: { kind: "empty" } });
        return;
      }
      cacheParse(doc);
      dispatch({ type: "parse_succeeded", doc, fromCache: false, events: loadEvents(hash) });
    } catch {
      dispatch({ type: "parse_failed", error: { kind: "corrupt" } });
    }
  }, []);

  const proposeEdit = useCallback(
    async (blockId: string, baseText: string, instruction: string, sectionTitle: string | null) => {
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: "edit_started", blockId, baseText, instruction, sectionTitle });
      try {
        const res = await fetch("/api/edit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            blockText: baseText,
            instruction,
            ...(sectionTitle ? { sectionTitle } : {}),
          }),
        });
        if (!res.ok || !res.body) {
          let code = "upstream";
          try {
            code = ((await res.json()) as { error?: string }).error ?? code;
          } catch {
            // Non-JSON error body; the generic code already covers it.
          }
          dispatch({ type: "edit_failed", code });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          dispatch({ type: "proposal_chunk", text: decoder.decode(value, { stream: true }) });
        }
        dispatch({ type: "proposal_done" });
      } catch {
        if (controller.signal.aborted) return;
        dispatch({ type: "edit_failed", code: "network" });
      }
    },
    [],
  );

  const abortInFlight = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const clearConsistency = useCallback(() => {
    consistencyAbortRef.current?.abort();
    consistencyAbortRef.current = null;
    setConsistency(null);
  }, []);

  // Publish a card for this scan, sending the hit blocks to the judge when
  // there are any. Owns the abort handoff: entering here supersedes
  // whatever judge call was in flight.
  const judgeScan = useCallback(
    async (scan: ConsistencyScan, source: ConsistencySource, texts: Record<string, string>) => {
      consistencyAbortRef.current?.abort();
      const publish = (status: ConsistencyStatus, findings: ConsistencyFinding[]) =>
        setConsistency({ scan, status, findings, source });
      if (scan.hits.length === 0) {
        publish("judged", []);
        return;
      }
      publish("checking", []);
      // Truncated to the route's cap: a parsed block can exceed what an
      // editable block ever could, and one oversized candidate must not
      // reject the whole request.
      const candidates = [...groupHitsByBlock(scan.hits).entries()]
        .slice(0, MAX_CANDIDATES)
        .map(([blockId, entities]) => ({
          blockId,
          text: texts[blockId].slice(0, MAX_BLOCK_CHARS),
          entities,
        }));
      const controller = new AbortController();
      consistencyAbortRef.current = controller;
      try {
        const res = await fetch("/api/consistency", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            instruction: source.instruction,
            before: source.before,
            after: source.after,
            candidates,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { findings } = (await res.json()) as { findings: ConsistencyFinding[] };
        // A dismissed or superseded check must not write over the current
        // card; the catch path has the same guard.
        if (controller.signal.aborted) return;
        publish("judged", findings);
      } catch {
        // The judge is advisory; losing it degrades to the lexical hits.
        if (controller.signal.aborted) return;
        publish("unavailable", []);
      }
    },
    [],
  );

  const runConsistencyCheck = useCallback(
    (doc: ParsedDoc, events: EditEvent[], applied: ConsistencySource) => {
      // Other blocks are unaffected by this apply, so pre-apply events fold
      // to the correct current text; the applied block's entry is its new
      // text so revalidation sees the document as it now stands.
      const texts: Record<string, string> = {};
      for (const id of Object.keys(doc.blocks)) {
        texts[id] = id === applied.blockId ? applied.after : currentText(doc, events, id);
      }
      const scan = scanDocument(applied.before, applied.after, applied.blockId, texts);
      if (scan.hits.length === 0 && scan.departed.length === 0) {
        // Nothing to report leaves the previous card and any in-flight judge
        // call alone: a tone edit between follow-ups must not destroy
        // pending findings. An apply that touches a flagged entity
        // regenerates the card through its own scan.
        return;
      }
      void judgeScan(scan, applied, texts);
    },
    [judgeScan],
  );

  if (state.phase !== "ready") {
    return (
      <UploadScreen
        parsingFileName={state.phase === "parsing" ? state.fileName : null}
        error={state.phase === "idle" ? state.error : null}
        onFile={handleFile}
      />
    );
  }

  const { doc, fromCache, selectedBlockId, events, edit } = state;
  const selectedText = selectedBlockId ? currentText(doc, events, selectedBlockId) : null;

  return (
    <main className="flex h-screen flex-col">
      <TopBar
        fileName={doc.fileName}
        pageCount={doc.pageCount}
        blockCount={Object.keys(doc.blocks).length}
        fromCache={fromCache}
        onExport={() => {
          // docx loads on first use only, mirroring the pdf.js pattern.
          import("@/lib/exportDocx")
            .then(({ downloadDocx }) => downloadDocx(doc, (blockId) => currentText(doc, events, blockId)))
            .catch(() => setToast("Export failed"));
        }}
        onReset={() => {
          abortInFlight();
          clearConsistency();
          setPrefill(null);
          dispatch({ type: "reset" });
        }}
      />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          <ErrorBoundary>
            <DocumentView
              doc={doc}
              blockText={(blockId) => currentText(doc, events, blockId)}
              selectedBlockId={selectedBlockId}
              streamingBlockId={edit?.status === "streaming" ? edit.blockId : null}
              editedBlockIds={editedBlockIds(events)}
              onSelect={(blockId) => {
                abortInFlight();
                // A manual click never inherits a follow-up suggestion.
                setPrefill(null);
                dispatch({ type: "select_block", blockId });
              }}
            />
          </ErrorBoundary>
        </div>
        <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-edge p-6">
          {selectedBlockId && selectedText !== null ? (
            <EditPanel
              key={prefill?.blockId === selectedBlockId ? `${selectedBlockId}:${prefill.seq}` : selectedBlockId}
              blockText={selectedText}
              edit={edit}
              initialInstruction={prefill?.blockId === selectedBlockId ? prefill.instruction : undefined}
              onPropose={(instruction) =>
                proposeEdit(selectedBlockId, selectedText, instruction, sectionTitleFor(doc, events, selectedBlockId))
              }
              onApply={() => {
                // Mirrors the reducer's stale-apply guard so the check never
                // runs for an apply the reducer rejected.
                const willApply =
                  edit?.status === "proposed" &&
                  edit.baseText === currentText(doc, events, edit.blockId);
                const eventId = crypto.randomUUID();
                dispatch({ type: "apply_proposal", eventId });
                if (willApply && edit.status === "proposed") {
                  setToast(`Edit applied, ${edit.sectionTitle ?? "untitled section"}`);
                  runConsistencyCheck(doc, events, {
                    eventId,
                    blockId: edit.blockId,
                    before: edit.baseText,
                    after: edit.proposal,
                    instruction: edit.instruction,
                  });
                }
              }}
              onReject={() => dispatch({ type: "edit_dismissed" })}
              onRetry={() => {
                if (edit?.status === "error") {
                  proposeEdit(edit.blockId, edit.baseText, edit.instruction, edit.sectionTitle);
                }
              }}
              onDismiss={() => {
                abortInFlight();
                dispatch({ type: "edit_dismissed" });
              }}
            />
          ) : (
            <p className="text-sm text-muted">Select a block to edit it.</p>
          )}
          {consistency && (
            <ConsistencyCard
              scan={consistency.scan}
              status={consistency.status}
              findings={consistency.findings}
              blockLabel={(blockId) =>
                sectionTitleFor(doc, events, blockId) ?? `page ${doc.blocks[blockId].page}`
              }
              blockText={(blockId) => currentText(doc, events, blockId)}
              onFollowUp={(blockId, instruction) => {
                abortInFlight();
                setPrefill((p) => ({ blockId, instruction, seq: (p?.seq ?? 0) + 1 }));
                dispatch({ type: "select_block", blockId });
                // Show the user what they are about to fix; the panel alone
                // does not reveal where the block sits in the document.
                // Instant, not smooth: the edit panel autofocuses on remount
                // and that focus scroll cancels an in-flight smooth animation.
                document.getElementById(blockId)?.scrollIntoView({ block: "center" });
              }}
              onDismiss={clearConsistency}
            />
          )}
          <div className="mt-8 border-t border-edge pt-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">History</h2>
              {events.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmClear) {
                      setConfirmClear(true);
                      return;
                    }
                    abortInFlight();
                    clearConsistency();
                    dispatch({ type: "clear_history" });
                    setConfirmClear(false);
                    setToast("History cleared, document reset to original");
                  }}
                  className="text-xs text-muted transition-colors hover:text-foreground"
                >
                  {confirmClear ? "Really clear? Applied edits revert" : "Clear"}
                </button>
              )}
            </div>
            <HistorySidebar
              events={events}
              onUndo={(targetEventId) => {
                // Only undoing the card's own source apply invalidates its
                // findings; undoing an unrelated edit keeps the triage list.
                if (targetEventId === consistency?.source.eventId) {
                  clearConsistency();
                }
                dispatch({ type: "undo", targetEventId });
              }}
            />
          </div>
        </aside>
      </div>
      {toast && (
        <div className="fixed bottom-6 right-6 rounded-lg border border-edge bg-surface px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}
