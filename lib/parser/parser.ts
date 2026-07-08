import type { Block, ParsedDoc, RawItem, Section } from "../types";

// Every rule below exists because a measurement of the fixture corpus demanded
// it (see SPEC.md, corpus diagnostics round 2). Bump when output shape or rules
// change so the parse cache never serves stale structure.
export const PARSER_VERSION = 4;

// Items within this vertical distance belong to one visual line.
const LINE_Y_TOL = 3;
// A wider in-line gap means left/right aligned spans (address left, date
// right), never columns; measured in every fixture.
const SPAN_GAP = 100;
// The corpus splits words into fragment items at near-zero gaps
// ("M|icrosoft", "Commit|tee,"). Measured gap distribution is bimodal:
// fragments sit under 1pt, word spaces start at 2pt, nothing in between.
const GLUE_GAP = 1.5;
// A vertical gap this many times the typical leading starts a new block.
const BLOCK_GAP_FACTOR = 1.8;
// A line repeating at the same y-band on this many pages is page furniture.
const FURNITURE_MIN_PAGES = 3;
const FURNITURE_Y_BAND = 6;
// Headings are short. MECO headings match body size exactly, so ALL-CAPS is
// the primary signal and a font-size jump is only the hidden-fixture fallback.
const HEADING_MAX_CHARS = 60;
const HEADING_SIZE_JUMP = 1.2;
// Column channel detection, thresholds measured on both layout fixtures
// (context/diagnostics/columns-diag.ts): real channels are 10pt+ wide with
// content mass on both sides and only title lines crossing. A letterhead
// pair is one row, so a channel also needs vertical extent.
const COLUMN_STEP = 2;
const COLUMN_MIN_WIDTH = 10;
const COLUMN_MAX_CROSS = 0.15;
const COLUMN_MIN_SIDE = 0.15;
const COLUMN_MIN_ROWS = 8;
const COLUMN_ROW_BAND = 4;
const COLUMN_EDGE_TOL = 2;

export type Line = { y: number; size: number; spans: string[] };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Geometric sort is mandatory: pdf.js emits raw content-stream order (Canva
// draw order) and the worst fixture pages score 0.75 on top-to-bottom order.
export function buildLines(items: RawItem[]): Line[] {
  const usable = items.filter((it) => it.str.trim().length > 0);
  const sorted = [...usable].sort((a, b) => b.y - a.y);

  const groups: RawItem[][] = [];
  let lineY = Infinity;
  for (const item of sorted) {
    const current = groups[groups.length - 1];
    if (current && lineY - item.y <= LINE_Y_TOL) {
      current.push(item);
    } else {
      groups.push([item]);
      lineY = item.y;
    }
  }

  const lines: Line[] = [];
  for (const group of groups) {
    const inLine = [...group].sort((a, b) => a.x - b.x);
    const spans: string[] = [];
    let parts: string[] = [];
    let prev: RawItem | undefined;
    for (const item of inLine) {
      const text = item.str.replace(/\s+/g, " ").trim();
      const gap = prev ? item.x - (prev.x + prev.w) : Infinity;
      if (gap > SPAN_GAP && parts.length > 0) {
        spans.push(parts.join(" "));
        parts = [];
      }
      // Stacked Canva text effects emit whole-string repeats at near-identical
      // coordinates; consecutive identical runs collapse to one. Checked
      // before the glue rule: a stacked copy overlaps its original, so its
      // gap is a large negative number, never a fragment gap.
      if (parts[parts.length - 1] === text) {
        prev = item;
        continue;
      }
      if (parts.length > 0 && Math.abs(gap) < GLUE_GAP) {
        parts[parts.length - 1] += text;
      } else {
        parts.push(text);
      }
      prev = item;
    }
    if (parts.length > 0) spans.push(parts.join(" "));
    lines.push({
      y: group[0].y,
      size: median(group.map((it) => it.size)),
      spans,
    });
  }
  return lines;
}

// A vertical whitespace channel with content on both sides means a
// two-column page (the resume/sidebar layout class). Detected on raw item
// geometry, before line assembly fuses the columns.
export function findChannel(items: RawItem[]): { x0: number; x1: number } | null {
  const rowOf = (it: RawItem) => Math.round(it.y / COLUMN_ROW_BAND);
  const rows = new Set(items.map(rowOf));
  if (rows.size < COLUMN_MIN_ROWS) return null;
  const minX = Math.ceil(Math.min(...items.map((it) => it.x)));
  const maxX = Math.max(...items.map((it) => it.x + it.w));
  const maxCross = rows.size * COLUMN_MAX_CROSS;

  let best: { x0: number; x1: number } | null = null;
  let start: number | null = null;
  for (let x = minX; x <= maxX + COLUMN_STEP; x += COLUMN_STEP) {
    const cross = new Set(items.filter((it) => it.x < x && x < it.x + it.w).map(rowOf)).size;
    if (x <= maxX && cross <= maxCross) {
      start = start ?? x;
      continue;
    }
    if (start !== null && x - start >= COLUMN_MIN_WIDTH) {
      const x0 = start;
      const x1 = x - COLUMN_STEP;
      const left = items.filter((it) => it.x + it.w <= x0 + COLUMN_EDGE_TOL).length;
      const right = items.filter((it) => it.x >= x1 - COLUMN_EDGE_TOL).length;
      const minority = Math.min(left, right) / items.length;
      if (minority >= COLUMN_MIN_SIDE && (!best || x1 - x0 > best.x1 - best.x0)) {
        best = { x0, x1 };
      }
    }
    start = null;
  }
  return best;
}

// A page is a list of segments, each block-grouped independently. Ordinary
// pages are one segment. A column page becomes bands: each full-width line
// is a divider segment, and between dividers the left column reads before
// the right, so sidebar text never interleaves into body prose.
export function segmentPage(items: RawItem[]): Line[][] {
  const usable = items.filter((it) => it.str.trim().length > 0);
  const channel = findChannel(usable);
  if (!channel) return [buildLines(usable)];

  const left: RawItem[] = [];
  const right: RawItem[] = [];
  const crossing: RawItem[] = [];
  const mid = (channel.x0 + channel.x1) / 2;
  for (const it of usable) {
    // Only an item bridging the whole channel is a true divider. Sidebar
    // lines overhang the channel without reaching the far column; they
    // belong to their column, or they chop the other column's prose apart.
    const straddles =
      it.x <= channel.x0 + COLUMN_EDGE_TOL && it.x + it.w >= channel.x1 - COLUMN_EDGE_TOL;
    if (straddles) crossing.push(it);
    else if (it.x + it.w / 2 < mid) left.push(it);
    else right.push(it);
  }
  const dividers = buildLines(crossing);
  const leftLines = buildLines(left);
  const rightLines = buildLines(right);

  const segments: Line[][] = [];
  for (let k = -1; k < dividers.length; k++) {
    if (k >= 0) segments.push([dividers[k]]);
    const top = k === -1 ? Infinity : dividers[k].y;
    const bottom = k + 1 < dividers.length ? dividers[k + 1].y : -Infinity;
    const inBand = (line: Line) => line.y <= top && line.y > bottom;
    segments.push(leftLines.filter(inBand));
    segments.push(rightLines.filter(inBand));
  }
  return segments.filter((segment) => segment.length > 0);
}

function lineKey(line: Line): string {
  return `${line.spans.join("|").toLowerCase()}@${Math.round(line.y / FURNITURE_Y_BAND)}`;
}

// Footers and address strips recur at the same page position; they are page
// furniture, not editable paragraphs.
export function furnitureKeys(pageLines: Line[][]): Set<string> {
  const pagesByKey = new Map<string, Set<number>>();
  pageLines.forEach((lines, page) => {
    for (const line of lines) {
      const key = lineKey(line);
      const pages = pagesByKey.get(key) ?? new Set<number>();
      pages.add(page);
      pagesByKey.set(key, pages);
    }
  });
  const keys = new Set<string>();
  for (const [key, pages] of pagesByKey) {
    if (pages.size >= FURNITURE_MIN_PAGES) keys.add(key);
  }
  return keys;
}

export function groupBlocks(lines: Line[]): Line[][] {
  if (lines.length === 0) return [];
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0) gaps.push(gap);
  }
  // Leading is intra-paragraph spacing, so estimate it only from gaps small
  // enough to be intra-paragraph; on sparse pages every gap can be a section
  // gap, and a raw median would swallow the whole page into one block.
  const sizeMed = median(lines.map((line) => line.size)) || 12;
  const leading = median(gaps.filter((gap) => gap <= sizeMed * 2)) || sizeMed * 1.2;

  const blocks: Line[][] = [[lines[0]]];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > leading * BLOCK_GAP_FACTOR) {
      blocks.push([lines[i]]);
    } else {
      blocks[blocks.length - 1].push(lines[i]);
    }
  }
  return blocks;
}

// Heading-ness is a line property: MECO headings sit tight above their body
// text and would otherwise be swallowed into the paragraph block below them.
// A multi-span line is a layout row (address left, date right), never a heading.
export function isHeadingLine(line: Line, bodySize: number): boolean {
  const text = line.spans.join(" ");
  if (text.length > HEADING_MAX_CHARS || !/[A-Za-z]/.test(text)) return false;
  if (line.spans.length > 1) return false;
  if (text === text.toUpperCase()) return true;
  return line.size > bodySize * HEADING_SIZE_JUMP;
}

// Paragraph lines reflow with spaces; spans split at a wide gap keep their
// break so left/right aligned pairs never fuse into one string.
function blockText(lines: Line[]): string {
  return lines.map((line) => line.spans.join("\n")).join(" ").trim();
}

export function parsePages(
  pages: RawItem[][],
  meta: { fileHash: string; fileName: string },
): ParsedDoc {
  const pageSegments = pages.map(segmentPage);
  const pageLines = pageSegments.map((segments) => segments.flat());
  const furniture = furnitureKeys(pageLines);
  const bodySize = median(pageLines.flat().map((line) => line.size)) || 12;

  const blocks: Record<string, Block> = {};
  const sections: Section[] = [{ id: "s0", title: null, blockIds: [] }];
  let blockCount = 0;
  let lastKind: Block["kind"] | null = null;
  let lastPage = 0;

  const emit = (lines: Line[], kind: Block["kind"], page: number) => {
    const text = blockText(lines);
    if (text.length === 0) return;
    if (kind === "heading" && lastKind === "heading" && lastPage === page) {
      // Oversized display titles arrive one line per block with wide leading
      // ("Who We" / "Are"); consecutive heading blocks are one heading.
      const section = sections[sections.length - 1];
      const headingBlock = blocks[section.blockIds[0]];
      headingBlock.text += ` ${text}`;
      section.title = headingBlock.text;
      return;
    }
    const block: Block = { id: `b${blockCount++}`, page, kind, text };
    blocks[block.id] = block;
    if (kind === "heading") {
      sections.push({ id: `s${sections.length}`, title: text, blockIds: [block.id] });
    } else {
      sections[sections.length - 1].blockIds.push(block.id);
    }
    lastKind = kind;
    lastPage = page;
  };

  pageSegments.forEach((segments, pageIndex) => {
    for (const segment of segments) {
      // A segment boundary is a column or band switch; a display title never
      // continues across one.
      lastKind = null;
      const kept = segment.filter((line) => !furniture.has(lineKey(line)));
      for (const group of groupBlocks(kept)) {
        // Split the block into runs of heading and body lines so a heading
        // sitting tight above its paragraph still becomes its own block.
        let run: Line[] = [];
        let runIsHeading = false;
        for (const line of group) {
          const heading = isHeadingLine(line, bodySize);
          if (run.length > 0 && heading !== runIsHeading) {
            emit(run, runIsHeading ? "heading" : "paragraph", pageIndex + 1);
            run = [];
          }
          run.push(line);
          runIsHeading = heading;
        }
        if (run.length > 0) emit(run, runIsHeading ? "heading" : "paragraph", pageIndex + 1);
      }
    }
  });

  return {
    fileHash: meta.fileHash,
    fileName: meta.fileName,
    pageCount: pages.length,
    blocks,
    sections: sections.filter((section) => section.blockIds.length > 0),
  };
}
