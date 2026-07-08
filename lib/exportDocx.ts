import { DeletedTextRun, Document, HeadingLevel, InsertedTextRun, Packer, Paragraph, TextRun } from "docx";
import { diffWords } from "diff";
import type { ParsedDoc } from "./types";

// Build a Word document from the parsed structure with edits applied.
// Headings map to Word's Heading 1 style and paragraphs to body text: the
// export mirrors the app's structured-text view, not the PDF's layout.
// Edited blocks export as real Word tracked changes (the net diff between
// the parsed original and the current text), because consultants review in
// tracked changes and the audit trail should land in their native tool.

type RunOptions = { text: string; break?: 1 };

// A diff part's text can span line breaks; every segment after a break
// carries Word's explicit line-break flag, matching the plain-text path.
function segmentRuns(value: string): RunOptions[] {
  return value
    .split("\n")
    .map((segment, i) => (i === 0 ? { text: segment } : { text: segment, break: 1 }));
}

function trackedRuns(
  original: string,
  current: string,
  revision: () => number,
): (TextRun | InsertedTextRun | DeletedTextRun)[] {
  const runs: (TextRun | InsertedTextRun | DeletedTextRun)[] = [];
  // One timestamp for the whole export: the tracked diff is the net change
  // across possibly several applies, so per-edit times would be a fiction.
  const date = new Date().toISOString();
  for (const part of diffWords(original, current)) {
    for (const options of segmentRuns(part.value)) {
      if (part.added) {
        runs.push(new InsertedTextRun({ ...options, id: revision(), author: "Proposal Editor", date }));
      } else if (part.removed) {
        runs.push(new DeletedTextRun({ ...options, id: revision(), author: "Proposal Editor", date }));
      } else {
        runs.push(new TextRun(options));
      }
    }
  }
  return runs;
}

export function buildDocx(doc: ParsedDoc, blockText: (blockId: string) => string): Document {
  let revisionId = 0;
  const revision = () => ++revisionId;
  const children = doc.sections.flatMap((section) =>
    section.blockIds.map((blockId) => {
      const block = doc.blocks[blockId];
      const current = blockText(blockId);
      const heading = block.kind === "heading" ? HeadingLevel.HEADING_1 : undefined;
      if (current !== block.text) {
        return new Paragraph({ heading, children: trackedRuns(block.text, current, revision) });
      }
      const lines = current.split("\n");
      return new Paragraph({
        heading,
        children: lines.map(
          (line, i) => new TextRun(i === 0 ? { text: line } : { text: line, break: 1 }),
        ),
      });
    }),
  );
  return new Document({ sections: [{ children }] });
}

export async function downloadDocx(
  doc: ParsedDoc,
  blockText: (blockId: string) => string,
): Promise<void> {
  const blob = await Packer.toBlob(buildDocx(doc, blockText));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = doc.fileName.replace(/\.pdf$/i, "") + ".docx";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Deferred revoke: doing it synchronously can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
