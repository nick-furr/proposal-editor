import { describe, expect, it } from "vitest";
import type { RawItem } from "../types";
import { buildLines, groupBlocks, parsePages } from "./parser";

// Inputs are synthetic but shaped exactly like the defects measured in the
// fixture corpus (see SPEC.md, corpus diagnostics round 2). No fixture text
// appears here; the fixtures are real client documents and stay gitignored.

function item(
  str: string,
  x: number,
  y: number,
  size = 12,
  w = str.length * 5,
  font = "",
): RawItem {
  return { str, x, y, size, w, font };
}

const meta = { fileHash: "test", fileName: "test.pdf" };

function allText(pages: RawItem[][]): string[] {
  const doc = parsePages(pages, meta);
  return Object.values(doc.blocks).map((b) => b.text);
}

describe("stacked text dedupe", () => {
  it("collapses whole-string repeats at near-identical coordinates", () => {
    // The cover title arrives three times from a layered text effect.
    const page = [
      item("Qualification Summary", 100, 700, 28),
      item("Qualification Summary", 100.4, 699.8, 28),
      item("Qualification Summary", 100.2, 700.1, 28),
    ];
    const lines = buildLines(page);
    expect(lines).toHaveLength(1);
    expect(lines[0].spans).toEqual(["Qualification Summary"]);
  });

  it("keeps genuinely repeated words that are separate runs of a sentence", () => {
    const lines = buildLines([
      item("had", 60, 500),
      item("had we known", 100, 500),
    ]);
    expect(lines[0].spans[0]).toBe("had had we known");
  });
});

describe("fragment glue at near-zero gaps", () => {
  it("rejoins a word split into a leading letter and its remainder", () => {
    // Measured shape: "M|icrosoft Office" with a 0pt gap between items.
    const lines = buildLines([
      item("M", 60, 500, 12, 8),
      item("icrosoft Office", 68, 500, 12, 80),
    ]);
    expect(lines[0].spans).toEqual(["Microsoft Office"]);
  });

  it("rejoins multi-fragment splits mid-word", () => {
    // Measured shape: "P|an|el Room" split at arbitrary points, gaps under 1pt.
    const lines = buildLines([
      item("P", 60, 500, 12, 6),
      item("an", 66.3, 500, 12, 10),
      item("el Room", 76.8, 500, 12, 40),
    ]);
    expect(lines[0].spans).toEqual(["Panel Room"]);
  });

  it("keeps a space at ordinary word gaps", () => {
    const lines = buildLines([
      item("Selection", 60, 500, 12, 50),
      item("Committee", 114, 500, 12, 52),
    ]);
    expect(lines[0].spans).toEqual(["Selection Committee"]);
  });
});

describe("span splitting at wide gaps", () => {
  it("splits left/right aligned pairs instead of fusing them", () => {
    // Address on the left margin, date on the right; the gap is over 100pt.
    const page = [
      item("400 Oak Street, Suite 2", 60, 720, 10, 110),
      item("July 3, 2025", 480, 720, 10, 60),
    ];
    const lines = buildLines(page);
    expect(lines).toHaveLength(1);
    expect(lines[0].spans).toEqual(["400 Oak Street, Suite 2", "July 3, 2025"]);
    const doc = parsePages([page], meta);
    const texts = Object.values(doc.blocks).map((b) => b.text);
    expect(texts[0]).toBe("400 Oak Street, Suite 2\nJuly 3, 2025");
  });

  it("does not split at ordinary word gaps", () => {
    const lines = buildLines([
      item("The firm has", 60, 500, 12, 70),
      item("served the region", 135, 500, 12, 90),
    ]);
    expect(lines[0].spans).toEqual(["The firm has served the region"]);
  });
});

describe("heading detection", () => {
  it("detects an ALL-CAPS short line at body font size", () => {
    // MECO headings are size 12, identical to body text; a font-size
    // heuristic alone finds zero headings.
    const page = [
      item("PROJECT TEAM", 60, 700, 12),
      item("Our staff brings decades of municipal experience.", 60, 660, 12),
    ];
    const doc = parsePages([page], meta);
    const heading = Object.values(doc.blocks).find((b) => b.kind === "heading");
    expect(heading?.text).toBe("PROJECT TEAM");
    const section = doc.sections.find((s) => s.title === "PROJECT TEAM");
    expect(section).toBeDefined();
    expect(section!.blockIds).toHaveLength(2);
  });

  it("falls back to a font-size jump for mixed-case headings", () => {
    const page = [
      item("Project Team", 60, 700, 20),
      item("Body text at normal size fills out this paragraph nicely.", 60, 660, 12),
      item("It continues on a second line to anchor the body median.", 60, 646, 12),
    ];
    const doc = parsePages([page], meta);
    const heading = Object.values(doc.blocks).find((b) => b.kind === "heading");
    expect(heading?.text).toBe("Project Team");
  });

  it("peels a heading out of the paragraph block it sits tight above", () => {
    // Sub-headings sit one leading above their body text, so vertical gaps
    // alone group them into the paragraph block.
    const page = [
      item("CORPORATE REGISTRATION", 60, 700, 12),
      item("The firm is registered with the state board.", 60, 686, 12),
      item("Registration renews annually.", 60, 672, 12),
    ];
    const doc = parsePages([page], meta);
    const kinds = Object.values(doc.blocks).map((b) => b.kind);
    expect(kinds).toEqual(["heading", "paragraph"]);
    expect(doc.sections[0].title).toBe("CORPORATE REGISTRATION");
  });

  it("merges consecutive display-title lines into one heading", () => {
    // Oversized two-line titles arrive as separate blocks with wide leading.
    const page = [
      item("Who We", 60, 700, 34),
      item("Are", 60, 640, 34),
      item("Body text explains the firm history at normal size.", 60, 600, 12),
      item("More body text keeps the median anchored at twelve.", 60, 586, 12),
      item("A third body line so body size outweighs the title.", 60, 572, 12),
    ];
    const doc = parsePages([page], meta);
    const headings = Object.values(doc.blocks).filter((b) => b.kind === "heading");
    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe("Who We Are");
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].title).toBe("Who We Are");
  });

  it("does not mistake a long sentence for a heading", () => {
    const page = [
      item("THIS ENTIRE SENTENCE IS SHOUTED BUT RUNS FAR TOO LONG TO BE A SECTION HEADING", 60, 700, 12, 400),
    ];
    const doc = parsePages([page], meta);
    expect(Object.values(doc.blocks)[0].kind).toBe("paragraph");
  });
});

describe("geometric sort", () => {
  it("recovers reading order from shuffled emission order", () => {
    // KB fixtures score as low as 0.75 on monotonic top-to-bottom emission.
    const page = [
      item("third line of the paragraph.", 60, 672),
      item("First line of the paragraph,", 60, 700),
      item("second line, then the", 60, 686),
    ];
    const [text] = allText([page]);
    expect(text).toBe(
      "First line of the paragraph, second line, then the third line of the paragraph.",
    );
  });

  it("orders items on one line by x position", () => {
    const lines = buildLines([
      item("world", 120, 500, 12, 30),
      item("Hello", 60, 500, 12, 30),
    ]);
    expect(lines[0].spans).toEqual(["Hello world"]);
  });
});

describe("furniture filter", () => {
  const footer = (y: number) => item("Prepared for the City | Page", 200, y, 8);

  it("drops a line repeating at the same y-band on three or more pages", () => {
    const body = (text: string) => item(text, 60, 500);
    const pages = [
      [body("Unique paragraph one."), footer(30)],
      [body("Unique paragraph two."), footer(31)],
      [body("Unique paragraph three."), footer(29)],
    ];
    const texts = allText(pages);
    expect(texts).toHaveLength(3);
    expect(texts.join(" ")).not.toContain("Page");
  });

  it("keeps a line that only repeats on two pages", () => {
    const pages = [
      [item("Alpha.", 60, 500), footer(30)],
      [item("Beta.", 60, 500), footer(30)],
      [item("Gamma.", 60, 500)],
    ];
    const texts = allText(pages);
    expect(texts.filter((t) => t.includes("Page"))).toHaveLength(2);
  });
});

describe("block grouping", () => {
  it("starts a new block at a vertical gap well above typical leading", () => {
    const lines = buildLines([
      item("Paragraph one, line one.", 60, 700),
      item("Paragraph one, line two.", 60, 686),
      item("Paragraph two after a wide gap.", 60, 620),
    ]);
    const blocks = groupBlocks(lines);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveLength(2);
  });
});

describe("font-run subheadings", () => {
  // The resume project labels are body-size mixed case; the font run is the
  // only signal, and it is scoped to prose-dominated column streams because
  // document-wide it shatters cover typography into sections.
  const sideItem = (str: string, y: number) => item(str, 60, y, 12, 80, "f-side");
  const bodyAt = (str: string, y: number, font: string, w = 230) => item(str, 260, y, 12, w, font);

  it("peels bold-only labels out of a resume body column", () => {
    const page = [
      sideItem("office location", 700),
      sideItem("northern branch", 686),
      sideItem("years of practice", 672),
      bodyAt("Project Manager: City of Rivertown, IL", 700, "f-bold", 190),
      bodyAt("Design of the water system improvements and", 686, "f-body"),
      bodyAt("construction phase services for the district.", 672, "f-body"),
      bodyAt("Engineer: Lakeside Water Commission", 658, "f-bold", 180),
      bodyAt("Supply, treatment, and distribution improvements.", 644, "f-body"),
      bodyAt("The district retained the firm for construction", 630, "f-body"),
      bodyAt("phase services and resident inspection through", 616, "f-body"),
      bodyAt("final completion of the improvements program.", 602, "f-body"),
    ];
    const doc = parsePages([page], meta);
    const headings = Object.values(doc.blocks)
      .filter((b) => b.kind === "heading")
      .map((b) => b.text);
    expect(headings).toContain("Project Manager: City of Rivertown, IL");
    expect(headings).toContain("Engineer: Lakeside Water Commission");
    // The sidebar column keeps its own font without growing sections.
    expect(headings.some((h) => h.includes("office location"))).toBe(false);
  });

  it("leaves single-column pages alone even with minority fonts", () => {
    // Cover pages and letters are full of display fonts; the rule must not
    // touch them.
    const page = [
      item("Dear Mayor Wells and Selection Committee,", 60, 700, 12, 210, "f-salutation"),
      item("The firm is pleased to present qualifications for", 60, 686, 12, 240, "f-body"),
      item("professional engineering services to the city.", 60, 672, 12, 230, "f-body"),
      item("We appreciate the opportunity to be considered.", 60, 658, 12, 235, "f-body"),
    ];
    const doc = parsePages([page], meta);
    expect(Object.values(doc.blocks).every((b) => b.kind === "paragraph")).toBe(true);
  });
});

describe("furniture exemption for heading-shaped lines", () => {
  it("keeps a repeating sidebar label and still drops the footer", () => {
    // OFFICE LOCATION repeats at the same y-band on three resume pages,
    // exactly like a footer; heading shape is what separates label from
    // furniture. The real footer stays dropped.
    const footer = (y: number) => item("400 Oak St | Rivertown, MO | 555-0100", 200, y, 8);
    const pages = [
      [item("OFFICE LOCATION", 60, 700, 12), item("Rivertown, MO", 60, 686), footer(30)],
      [item("OFFICE LOCATION", 60, 700, 12), item("Lakeside, MO", 60, 686), footer(30)],
      [item("OFFICE LOCATION", 60, 700, 12), item("Hillcrest, MO", 60, 686), footer(30)],
    ];
    const doc = parsePages(pages, meta);
    const titles = doc.sections.filter((s) => s.title === "OFFICE LOCATION");
    expect(titles).toHaveLength(3);
    const texts = Object.values(doc.blocks).map((b) => b.text);
    expect(texts.join(" ")).not.toContain("555-0100");
    expect(texts).toContain("Rivertown, MO");
  });
});

describe("column routing", () => {
  // Shapes match the measured resume pages: a narrow left sidebar, a wide
  // right body column, and a persistent whitespace channel between them.
  const sidebar = (str: string, y: number) => item(str, 60, y, 12, 80);
  const body = (str: string, y: number) => item(str, 260, y, 12, 240);

  it("routes a two-column page as left column then right column", () => {
    const page = [
      sidebar("office location", 700),
      sidebar("northern branch", 686),
      sidebar("years of practice", 672),
      body("The engineer manages daily operations across", 700),
      body("the firm and oversees work in progress on", 686),
      body("projects of every size in the region, while", 672),
      body("coordinating funding and regulatory agencies", 658),
      body("to keep approvals moving through review and", 644),
      body("maximize the grant dollars available to the", 630),
      body("client, with modeling platforms built for the", 616),
      body("firm's own engineering applications in house.", 602),
    ];
    const texts = allText([page]);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe("office location northern branch years of practice");
    expect(texts[1]).toBe(
      "The engineer manages daily operations across the firm and oversees work in progress on projects of every size in the region, while coordinating funding and regulatory agencies to keep approvals moving through review and maximize the grant dollars available to the client, with modeling platforms built for the firm's own engineering applications in house.",
    );
  });

  it("treats a full-width line as a band divider above the columns", () => {
    const page = [
      item("A TITLE THAT SPANS THE WHOLE PAGE WIDTH", 60, 740, 12, 440),
      sidebar("left notes here", 700),
      sidebar("more left notes", 686),
      body("Right column prose fills the wide side and", 700),
      body("continues for several lines of real text to", 686),
      body("anchor the row count above the threshold.", 672),
      body("It keeps going so the channel has extent.", 658),
      body("One more line for good measure below that,", 644),
      body("and another so the vertical extent guard is", 630),
      body("satisfied the way real column pages are.", 616),
    ];
    const doc = parsePages([page], meta);
    const texts = Object.values(doc.blocks).map((b) => b.text);
    expect(texts[0]).toBe("A TITLE THAT SPANS THE WHOLE PAGE WIDTH");
    expect(texts[1]).toBe("left notes here more left notes");
    expect(texts[2]).toContain("Right column prose");
    expect(texts.some((t) => t.includes("left notes here") && t.includes("prose"))).toBe(false);
  });

  it("assigns a sidebar line that overhangs the channel to its column", () => {
    // Measured on the resume pages: sidebar list lines poke into the
    // whitespace channel without reaching the body column. They belong to
    // the sidebar, not to the divider stream, or they chop the body prose
    // into fragments.
    const page = [
      sidebar("office location", 700),
      sidebar("northern branch", 686),
      sidebar("years of practice", 672),
      item("with several specialties", 60, 658, 12, 150),
      body("The engineer manages daily operations across", 700),
      body("the firm and oversees work in progress on", 686),
      body("projects of every size in the region, while", 672),
      body("coordinating funding and regulatory agencies", 658),
      body("to keep approvals moving through review and", 644),
      body("maximize the grant dollars available to the", 630),
      body("client, with modeling platforms built for the", 616),
      body("firm's own engineering applications in house.", 602),
    ];
    const texts = allText([page]);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe(
      "office location northern branch years of practice with several specialties",
    );
    expect(texts[1]).toContain("The engineer manages daily operations");
  });

  it("keeps full-width prose spanning the channel as one block", () => {
    // Column-major assembly groups all full-width lines into one stream, so
    // wrapped prose whose lines all straddle the channel reassembles. The
    // residual limit (a wrapped sentence whose SECOND line is short enough
    // to fall into a column) still splits; that needs region-scoped
    // channels and stays a documented boundary.
    const page = [
      item("The firm is a corporation with principals, owners,", 60, 760, 12, 420),
      item("a board of directors and officers, as filed with the state.", 60, 746, 12, 420),
      sidebar("office location", 700),
      sidebar("northern branch", 686),
      sidebar("years of practice", 672),
      body("The engineer manages daily operations across", 700),
      body("the firm and oversees work in progress on", 686),
      body("projects of every size in the region, while", 672),
      body("coordinating funding and regulatory agencies", 658),
      body("to keep approvals moving through review and", 644),
      body("maximize the grant dollars available to the", 630),
      body("client, with modeling platforms built for the", 616),
      body("firm's own engineering applications in house,", 602),
      body("across water, wastewater, and municipal work", 588),
      body("of every size, with the same disciplined and", 574),
      body("well documented process on each engagement,", 560),
      body("start to finish and year over year besides.", 546),
    ];
    const texts = allText([page]);
    expect(texts[0]).toBe(
      "The firm is a corporation with principals, owners, a board of directors and officers, as filed with the state.",
    );
    expect(texts).toHaveLength(3);
  });

  it("does not column-split a page that is only a left/right aligned pair", () => {
    // The letterhead shape: one address line left, one date right. A channel
    // needs vertical extent; a single row is a span pair, not columns.
    const page = [
      item("400 Oak Street, Suite 2", 60, 720, 10, 110),
      item("July 3, 2025", 480, 720, 10, 60),
    ];
    const doc = parsePages([page], meta);
    const texts = Object.values(doc.blocks).map((b) => b.text);
    expect(texts).toEqual(["400 Oak Street, Suite 2\nJuly 3, 2025"]);
  });
});

describe("empty and degenerate input", () => {
  it("returns zero blocks for pages with no usable text", () => {
    const doc = parsePages([[item("   ", 60, 500)], []], meta);
    expect(Object.keys(doc.blocks)).toHaveLength(0);
    expect(doc.sections).toHaveLength(0);
    expect(doc.pageCount).toBe(2);
  });
});
