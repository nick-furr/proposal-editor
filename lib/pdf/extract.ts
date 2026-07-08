// The only pdf.js touchpoint in the app. Loaded exclusively in the browser
// (dynamically imported from the upload handler), so pdf.js never evaluates
// during server rendering.
import * as pdfjs from "pdfjs-dist";
import type { RawItem } from "../types";

export const MAX_PAGES = 100;

// Near-zero text items across a whole document means a scanned PDF: images
// of text, no text layer.
const SCANNED_ITEM_THRESHOLD = 5;

export type ExtractResult =
  | { ok: true; pages: RawItem[][] }
  | { ok: false; reason: "password" | "corrupt" | "scanned" }
  | { ok: false; reason: "too-many-pages"; pageCount: number };

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export async function extractPages(buffer: ArrayBuffer): Promise<ExtractResult> {
  const task = pdfjs.getDocument({ data: buffer });
  try {
    let doc: pdfjs.PDFDocumentProxy;
    try {
      doc = await task.promise;
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      return { ok: false, reason: name === "PasswordException" ? "password" : "corrupt" };
    }

    if (doc.numPages > MAX_PAGES) {
      return { ok: false, reason: "too-many-pages", pageCount: doc.numPages };
    }
    const pages: RawItem[][] = [];
    let itemCount = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: RawItem[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim().length === 0) continue;
        // Rotated text is decoration in this document class (vertical
        // "Thank You" art, margin tabs), measured corpus-wide: no body text
        // is ever rotated. The geometric rules assume horizontal items, so
        // rotated ones are excluded rather than mangled.
        if (Math.abs(Math.atan2(item.transform[1], item.transform[0])) > 0.1) continue;
        items.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          size: Math.abs(item.transform[3]),
          w: item.width,
        });
      }
      itemCount += items.length;
      pages.push(items);
    }
    if (itemCount < SCANNED_ITEM_THRESHOLD) {
      return { ok: false, reason: "scanned" };
    }
    return { ok: true, pages };
  } finally {
    // 12 to 18MB fixtures: free the worker memory promptly.
    void task.destroy();
  }
}
