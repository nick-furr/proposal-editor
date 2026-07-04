"use client";

import { useRef, useState } from "react";

export type UploadError =
  | { kind: "wrong-type" | "too-large" | "password" | "corrupt" | "scanned" | "empty" }
  | { kind: "too-many-pages"; pageCount: number };

function message(error: UploadError): string {
  switch (error.kind) {
    case "wrong-type":
      return "That file is not a PDF. Upload a .pdf file.";
    case "too-large":
      return "That file is over the 25MB limit.";
    case "password":
      return "This PDF is password-protected. Remove the password and upload it again.";
    case "corrupt":
      return "This file could not be read as a PDF. It may be damaged.";
    case "scanned":
      return "This looks like a scanned document. There is no text layer to edit, and scanned PDFs are not supported yet.";
    case "empty":
      return "The document parsed, but no editable text blocks were found.";
    case "too-many-pages":
      return `This PDF has ${error.pageCount} pages, over the 100-page limit.`;
  }
}

export function UploadScreen({
  parsingFileName,
  error,
  onFile,
}: {
  parsingFileName: string | null;
  error: UploadError | null;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  if (parsingFileName) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="animate-pulse text-lg">Parsing {parsingFileName}</p>
        <p className="text-sm text-muted">The file stays in your browser. Nothing is uploaded.</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Proposal Editor</h1>
        <p className="mt-2 text-sm text-muted">
          Upload a proposal PDF, select a paragraph, and refine it in place.
        </p>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        className={`w-full max-w-lg rounded-xl border border-dashed p-14 text-center transition-colors ${
          dragging ? "border-accent bg-surface" : "border-edge hover:border-muted"
        }`}
      >
        <p>Drop a PDF here or click to browse</p>
        <p className="mt-2 text-xs text-muted">Up to 25MB and 100 pages. Parsed locally in your browser.</p>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="max-w-lg text-center text-sm text-removed">
          {message(error)}
        </p>
      )}
    </main>
  );
}
