"use client";

export function TopBar({
  fileName,
  pageCount,
  blockCount,
  fromCache,
  onExport,
  onReset,
}: {
  fileName: string;
  pageCount: number;
  blockCount: number;
  fromCache: boolean;
  onExport: () => void;
  onReset: () => void;
}) {
  return (
    <header className="flex items-baseline gap-3 border-b border-edge px-6 py-3">
      <h1 className="truncate text-sm font-semibold">{fileName}</h1>
      <span className="shrink-0 text-xs text-muted">
        {pageCount} pages, {blockCount} blocks
      </span>
      {fromCache && (
        <span className="shrink-0 rounded bg-surface px-2 py-0.5 text-xs text-accent">
          restored from cache
        </span>
      )}
      <button
        type="button"
        onClick={onExport}
        className="ml-auto shrink-0 text-xs text-muted transition-colors hover:text-foreground"
      >
        Export DOCX
      </button>
      <button
        type="button"
        onClick={onReset}
        className="shrink-0 text-xs text-muted transition-colors hover:text-foreground"
      >
        New file
      </button>
    </header>
  );
}
