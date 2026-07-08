// Node-side pdf.js extraction for the eval runner and KB ingestion. Mirrors
// the item mapping in lib/pdf/extract.ts; the legacy build runs workerless in
// node, so the browser module (which wires a bundled worker) stays untouched.
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { RawItem } from "../lib/types";

export async function extractPdfPages(path: string): Promise<RawItem[][]> {
  const data = new Uint8Array(readFileSync(path));
  const task = getDocument({ data, verbosity: 0 });
  const doc = await task.promise;
  const pages: RawItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: RawItem[] = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim().length === 0) continue;
      // Mirrors the rotated-text exclusion in lib/pdf/extract.ts.
      if (Math.abs(Math.atan2(item.transform[1], item.transform[0])) > 0.1) continue;
      items.push({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        size: Math.abs(item.transform[3]),
        w: item.width,
        font: item.fontName,
      });
    }
    pages.push(items);
  }
  await task.destroy();
  return pages;
}
