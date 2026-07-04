"use client";

import { useCallback, useReducer } from "react";
import { sha256Hex } from "@/lib/hash";
import { cacheParse, getCachedParse } from "@/lib/parseCache";
import { parsePages } from "@/lib/parser/parser";
import type { ParsedDoc } from "@/lib/types";
import { DocumentView } from "./DocumentView";
import { ErrorBoundary } from "./ErrorBoundary";
import { TopBar } from "./TopBar";
import { UploadScreen, type UploadError } from "./UploadScreen";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

type State =
  | { phase: "idle"; error: UploadError | null }
  | { phase: "parsing"; fileName: string }
  | { phase: "ready"; doc: ParsedDoc; fromCache: boolean; selectedBlockId: string | null };

type Action =
  | { type: "parse_started"; fileName: string }
  | { type: "parse_failed"; error: UploadError }
  | { type: "parse_succeeded"; doc: ParsedDoc; fromCache: boolean }
  | { type: "select_block"; blockId: string | null }
  | { type: "reset" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "parse_started":
      return { phase: "parsing", fileName: action.fileName };
    case "parse_failed":
      return { phase: "idle", error: action.error };
    case "parse_succeeded":
      return { phase: "ready", doc: action.doc, fromCache: action.fromCache, selectedBlockId: null };
    case "select_block":
      if (state.phase !== "ready") return state;
      return { ...state, selectedBlockId: action.blockId };
    case "reset":
      return { phase: "idle", error: null };
  }
}

export function EditorApp() {
  const [state, dispatch] = useReducer(reducer, { phase: "idle", error: null });

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
        dispatch({ type: "parse_succeeded", doc: cached, fromCache: true });
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
      dispatch({ type: "parse_succeeded", doc, fromCache: false });
    } catch {
      dispatch({ type: "parse_failed", error: { kind: "corrupt" } });
    }
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

  const { doc, fromCache, selectedBlockId } = state;
  return (
    <main className="flex h-screen flex-col">
      <TopBar
        fileName={doc.fileName}
        pageCount={doc.pageCount}
        blockCount={Object.keys(doc.blocks).length}
        fromCache={fromCache}
        onReset={() => dispatch({ type: "reset" })}
      />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          <ErrorBoundary>
            <DocumentView
              doc={doc}
              blockText={(blockId) => doc.blocks[blockId].text}
              selectedBlockId={selectedBlockId}
              onSelect={(blockId) => dispatch({ type: "select_block", blockId })}
            />
          </ErrorBoundary>
        </div>
        <aside className="w-96 shrink-0 overflow-y-auto border-l border-edge p-6">
          <p className="text-sm text-muted">
            {selectedBlockId ? "Editing arrives in the next commit." : "Select a block to edit it."}
          </p>
        </aside>
      </div>
    </main>
  );
}
