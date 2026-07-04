// Raw text item as measured from pdf.js getTextContent; mirrors the shape
// used by the corpus diagnostics that every parser rule was derived from.
export type RawItem = {
  str: string;
  x: number;
  y: number;
  size: number;
  w: number;
};

export type Block = {
  id: string;
  page: number;
  kind: "heading" | "paragraph";
  text: string;
};

export type Section = {
  id: string;
  title: string | null;
  blockIds: string[];
};

export type ParsedDoc = {
  fileHash: string;
  fileName: string;
  pageCount: number;
  blocks: Record<string, Block>;
  sections: Section[];
};

// Append-only edit log. Undo appends rather than popping, so the whole
// history is serializable and redo stays possible later without rework.
export type ApplyEvent = {
  id: string;
  type: "apply";
  blockId: string;
  sectionTitle: string | null;
  before: string;
  after: string;
  instruction: string;
  ts: number;
};

export type EditEvent = ApplyEvent | { id: string; type: "undo"; targetEventId: string; ts: number };
