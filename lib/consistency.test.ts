import { describe, expect, it } from "vitest";
import { containsEntity, parseFindings, revalidateScan, scanDocument } from "./consistency";

describe("scanDocument", () => {
  it("flags another block that still mentions a swapped city", () => {
    const before = "This proposal is prepared for the City of Dixon.";
    const after = "This proposal is prepared for the City of Fairview.";
    const scan = scanDocument(before, after, "b1", {
      b2: "Our office is 55 miles from Dixon and staffed year round.",
      b3: "We deliver on schedule and on budget.",
    });
    expect(scan.hits).toEqual([{ blockId: "b2", entity: "Dixon" }]);
  });

  it("reports a removed name that now appears nowhere as departed", () => {
    const before = "Officers: Dana Whitfield, President; Lee Moran, Secretary.";
    const after = "Officers: Lee Moran, Secretary.";
    const scan = scanDocument(before, after, "b1", {
      b2: "Lee Moran founded the firm in 1998.",
    });
    expect(scan.departed).toEqual(["Dana Whitfield"]);
    expect(scan.hits).toEqual([]);
  });

  it("finds nothing on a tone edit that moves no entities", () => {
    const before = "We are pleased to submit this proposal.";
    const after = "We submit this proposal with confidence.";
    const scan = scanDocument(before, after, "b1", { b2: "Dixon is our home base." });
    expect(scan.hits).toEqual([]);
    expect(scan.departed).toEqual([]);
  });

  it("ignores an entity the edit only moved within the block", () => {
    const before = "Dixon has been our client since 2019.";
    const after = "Since 2019 our client has been Dixon.";
    const scan = scanDocument(before, after, "b1", { b2: "The Dixon plant upgrade." });
    expect(scan.hits).toEqual([]);
  });

  it("does not treat a removed sentence opener as an entity", () => {
    const before = "The team brings decades of experience.";
    const after = "Decades of experience back this team.";
    const scan = scanDocument(before, after, "b1", { b2: "The schedule is fixed." });
    expect(scan.hits).toEqual([]);
  });

  it("keeps single-word departures out of the departed list but in the hits", () => {
    const before = "The site sits 55 miles from the plant.";
    const after = "The site sits 60 miles from the plant.";
    const withMention = scanDocument(before, after, "b1", { b2: "a 55 mile service radius" });
    expect(withMention.hits).toEqual([{ blockId: "b2", entity: "55" }]);
    const without = scanDocument(before, after, "b1", { b2: "no numbers here" });
    expect(without.departed).toEqual([]);
  });
});

describe("scanDocument entities", () => {
  it("carries the removed entities so the scan can be revalidated later", () => {
    const before = "This proposal is prepared for the City of Dixon.";
    const after = "This proposal is prepared for the City of Fairview.";
    const scan = scanDocument(before, after, "b1", { b2: "55 miles from Dixon." });
    expect(scan.entities).toEqual(["Dixon"]);
  });
});

describe("revalidateScan", () => {
  const dixonScan = (hits: { blockId: string; entity: string }[]) => ({
    entities: ["Dixon"],
    hits,
    departed: [],
  });

  it("empties when the last flagged block no longer mentions the entity", () => {
    const scan = dixonScan([{ blockId: "b2", entity: "Dixon" }]);
    const next = revalidateScan(scan, {
      b1: "Prepared for the City of Fairview.",
      b2: "Our office is 55 miles from Fairview.",
    }, "b1");
    expect(next.hits).toEqual([]);
    expect(next.departed).toEqual([]);
  });

  it("keeps rows for blocks that still mention the entity", () => {
    const scan = dixonScan([
      { blockId: "b2", entity: "Dixon" },
      { blockId: "b3", entity: "Dixon" },
    ]);
    const next = revalidateScan(scan, {
      b1: "Prepared for the City of Fairview.",
      b2: "Our office is 55 miles from Fairview.",
      b3: "Serving the City of Dixon since 1985.",
    }, "b1");
    expect(next.hits).toEqual([{ blockId: "b3", entity: "Dixon" }]);
  });

  it("drops an entity entirely once the source block mentions it again", () => {
    const scan = dixonScan([{ blockId: "b2", entity: "Dixon" }]);
    const next = revalidateScan(scan, {
      b1: "Prepared for the City of Dixon.",
      b2: "Our office is 55 miles from Dixon.",
    }, "b1");
    expect(next.entities).toEqual([]);
    expect(next.hits).toEqual([]);
  });

  it("gains a row when an undo restores a mention elsewhere", () => {
    const scan = dixonScan([{ blockId: "b2", entity: "Dixon" }]);
    const next = revalidateScan(scan, {
      b1: "Prepared for the City of Fairview.",
      b2: "Our office is 55 miles from Dixon.",
      b3: "The Dixon plant upgrade finished early.",
    }, "b1");
    expect(next.hits).toEqual([
      { blockId: "b2", entity: "Dixon" },
      { blockId: "b3", entity: "Dixon" },
    ]);
  });

  it("recomputes departed for a multi-word entity with no remaining mentions", () => {
    const scan = {
      entities: ["Dana Whitfield"],
      hits: [{ blockId: "b2", entity: "Dana Whitfield" }],
      departed: [],
    };
    const next = revalidateScan(scan, {
      b1: "Officers: Lee Moran, Secretary.",
      b2: "Lee Moran founded the firm.",
    }, "b1");
    expect(next.hits).toEqual([]);
    expect(next.departed).toEqual(["Dana Whitfield"]);
  });
});

describe("containsEntity", () => {
  it("matches on word boundaries only", () => {
    expect(containsEntity("a 55 mile radius", "55")).toBe(true);
    expect(containsEntity("call 555-1212", "55")).toBe(false);
    expect(containsEntity("Dixonville is elsewhere", "Dixon")).toBe(false);
  });

  it("matches hyphenated mentions", () => {
    expect(containsEntity("a Dixon-based firm", "Dixon")).toBe(true);
  });
});

describe("scanDocument entity cap", () => {
  it("caps removed entities so a rewrite cannot flood the judge", () => {
    const names = Array.from({ length: 10 }, (_, i) => `Firstname Lastname${i}.`);
    const before = `Team: ${names.join(" ")}`;
    const scan = scanDocument(before, "Team: reorganized.", "b1", {
      b2: names.map((n) => n.replace(".", "")).join(" and "),
    });
    expect(new Set(scan.hits.map((h) => h.entity)).size).toBe(8);
  });
});

describe("parseFindings", () => {
  const ids = new Set(["b2", "b3"]);

  it("parses a plain JSON array and keeps only string extras", () => {
    const raw = '[{"blockId":"b2","stale":true,"reason":"r","followUp":"f"},{"blockId":"b3","stale":false}]';
    expect(parseFindings(raw, ids)).toEqual([
      { blockId: "b2", stale: true, reason: "r", followUp: "f" },
      { blockId: "b3", stale: false },
    ]);
  });

  it("strips a code fence around the array", () => {
    const raw = '```json\n[{"blockId":"b2","stale":false}]\n```';
    expect(parseFindings(raw, ids)).toEqual([{ blockId: "b2", stale: false }]);
  });

  it("rejects prose, non-arrays, and missing verdicts", () => {
    expect(parseFindings("I could not find issues.", ids)).toBeNull();
    expect(parseFindings('{"blockId":"b2","stale":true}', ids)).toBeNull();
    expect(parseFindings('[{"blockId":"b2"}]', ids)).toBeNull();
  });

  it("skips a stray item for an unknown block without discarding the batch", () => {
    const raw = '[{"blockId":"b9","stale":true},{"blockId":"b2","stale":false}]';
    expect(parseFindings(raw, ids)).toEqual([{ blockId: "b2", stale: false }]);
  });
});
