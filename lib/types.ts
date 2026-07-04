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
