import { describe, expect, it } from "vitest";
import { containsEntity, scanDocument } from "./consistency";

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

describe("containsEntity", () => {
  it("matches on word boundaries only", () => {
    expect(containsEntity("a 55 mile radius", "55")).toBe(true);
    expect(containsEntity("call 555-1212", "55")).toBe(false);
    expect(containsEntity("Dixonville is elsewhere", "Dixon")).toBe(false);
  });
});
