"use client";

import { useCallback, useReducer } from "react";
import { sha256Hex } from "@/lib/hash";
import { cacheParse, getCachedParse } from "@/lib/parseCache";
import { parsePages } from "@/lib/parser/parser";
import type { ParsedDoc } from "@/lib/types";
import { UploadScreen, type UploadError } from "./UploadScreen";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

type State =
  | { phase: "idle"; error: UploadError | null }
  | { phase: "parsing"; fileName: string }
  | { phase: "ready"; doc: ParsedDoc; fromCache: boolean };

type Action =
  | { type: "parse_started"; fileName: string }
  | { type: "parse_failed"; error: UploadError }
  | { type: "parse_succeeded"; doc: ParsedDoc; fromCache: boolean };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "parse_started":
      return { phase: "parsing", fileName: action.fileName };
    case "parse_failed":
      return { phase: "idle", error: action.error };
    case "parse_succeeded":
      return { phase: "ready", doc: action.doc, fromCache: action.fromCache };
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

  const { doc, fromCache } = state;
  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-6 flex items-baseline gap-3">
        <h1 className="text-lg font-semibold">{doc.fileName}</h1>
        <span className="text-sm text-muted">
          {doc.pageCount} pages, {Object.keys(doc.blocks).length} blocks
        </span>
        {fromCache && (
          <span className="rounded bg-surface px-2 py-0.5 text-xs text-accent">
            restored from cache
          </span>
        )}
      </header>
      <div className="space-y-4">
        {doc.sections.map((section) => (
          <div key={section.id}>
            {section.title && <h2 className="mb-1 font-semibold text-accent">{section.title}</h2>}
            {section.blockIds
              .map((id) => doc.blocks[id])
              .filter((block) => block.kind === "paragraph")
              .map((block) => (
                <p key={block.id} className="mb-2 whitespace-pre-line text-sm">
                  {block.text}
                </p>
              ))}
          </div>
        ))}
      </div>
    </main>
  );
}
