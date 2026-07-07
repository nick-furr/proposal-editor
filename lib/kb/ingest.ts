// Build the KB index from the firm's past proposals with the same parser the
// app uses. Runs locally against gitignored fixtures; the output JSON also
// stays out of the public repo and reaches the deployed app as a private
// upload, never through git.
//
// Usage: npx tsx lib/kb/ingest.ts
import { readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { extractPdfPages } from "../../eval/extract-node";
import { parsePages } from "../parser/parser";
import type { KbEntry } from "./retrieve";

const KB_DIR = "context/fixtures/kb";
const OUT_PATH = "context/kb-index.json";
// Short blocks are furniture and headings the section field already carries.
const MIN_CHARS = 100;

async function main() {
  const entries: KbEntry[] = [];
  const seen = new Set<string>();
  for (const file of readdirSync(KB_DIR).filter((f) => f.endsWith(".pdf"))) {
    const pages = await extractPdfPages(join(KB_DIR, file));
    const doc = parsePages(pages, { fileHash: "kb", fileName: file });
    const docName = basename(file, ".pdf");
    for (const section of doc.sections) {
      for (const id of section.blockIds) {
        const block = doc.blocks[id];
        if (block.kind !== "paragraph" || block.text.length < MIN_CHARS) continue;
        // The five SOQs share whole boilerplate paragraphs; one copy is
        // enough or retrieval returns the same text twice.
        const key = block.text.replace(/\s+/g, " ").toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ doc: docName, section: section.title, text: block.text });
      }
    }
    console.log(`${file}: ${doc.sections.length} sections`);
  }
  writeFileSync(OUT_PATH, JSON.stringify(entries));
  const bytes = JSON.stringify(entries).length;
  console.log(`${entries.length} entries, ${(bytes / 1024).toFixed(0)}KB -> ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
