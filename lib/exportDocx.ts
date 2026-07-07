import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { ParsedDoc } from "./types";

// Build a Word document from the parsed structure with edits applied.
// Headings map to Word's Heading 1 style and paragraphs to body text: the
// export mirrors the app's structured-text view, not the PDF's layout.
export function buildDocx(doc: ParsedDoc, blockText: (blockId: string) => string): Document {
  const children = doc.sections.flatMap((section) =>
    section.blockIds.map((blockId) => {
      const block = doc.blocks[blockId];
      const lines = blockText(blockId).split("\n");
      return new Paragraph({
        heading: block.kind === "heading" ? HeadingLevel.HEADING_1 : undefined,
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
  anchor.click();
  URL.revokeObjectURL(url);
}
