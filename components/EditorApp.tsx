"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { currentText, editedBlockIds, lastUndoableEvent, loadEvents, saveEvents } from "@/lib/editLog";
import { sha256Hex } from "@/lib/hash";
import { cacheParse, getCachedParse } from "@/lib/parseCache";
import { parsePages } from "@/lib/parser/parser";
import type { EditEvent, ParsedDoc } from "@/lib/types";
import { DocumentView } from "./DocumentView";
import { EditPanel, type EditState } from "./EditPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { HistorySidebar } from "./HistorySidebar";
import { TopBar } from "./TopBar";
import { UploadScreen, type UploadError } from "./UploadScreen";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function sectionTitleFor(doc: ParsedDoc, blockId: string): string | null {
  return doc.sections.find((section) => section.blockIds.includes(blockId))?.title ?? null;
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
  | { type: "apply_proposal" }
  | { type: "undo"; targetEventId: string };

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
        id: crypto.randomUUID(),
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

export function EditorApp() {
  const [state, dispatch] = useReducer(reducer, { phase: "idle", error: null });
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

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
        onReset={() => {
          abortInFlight();
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
                dispatch({ type: "select_block", blockId });
              }}
            />
          </ErrorBoundary>
        </div>
        <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-edge p-6">
          {selectedBlockId && selectedText !== null ? (
            <EditPanel
              key={selectedBlockId}
              blockText={selectedText}
              edit={edit}
              onPropose={(instruction) =>
                proposeEdit(selectedBlockId, selectedText, instruction, sectionTitleFor(doc, selectedBlockId))
              }
              onApply={() => {
                dispatch({ type: "apply_proposal" });
                if (edit?.status === "proposed") {
                  setToast(`Edit applied, ${edit.sectionTitle ?? "untitled section"}`);
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
          <div className="mt-8 border-t border-edge pt-4">
            <h2 className="mb-3 text-sm font-semibold">History</h2>
            <HistorySidebar
              events={events}
              onUndo={(targetEventId) => dispatch({ type: "undo", targetEventId })}
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
