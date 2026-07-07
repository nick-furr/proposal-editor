import { describe, expect, it } from "vitest";
import { retrieve, type KbEntry } from "./retrieve";

// Synthetic corpus shaped like the real one: firm boilerplate everywhere,
// topical content rare.

const entry = (doc: string, section: string | null, text: string): KbEntry => ({ doc, section, text });

const index: KbEntry[] = [
  entry("doc-a", "OUR FIRM", "The firm serves municipalities across the region with engineering services."),
  entry("doc-a", "EXPERIENCE", "Designed the Rivertown wastewater treatment plant expansion for the city."),
  entry("doc-b", "OUR FIRM", "The firm serves municipalities across the region with engineering services and pride."),
  entry("doc-b", "EXPERIENCE", "Bridge replacement over Clear Creek including hydraulic engineering studies."),
  entry("doc-c", "TEAM", "Staff engineers hold licenses in several states."),
];

describe("retrieve", () => {
  it("ranks rare topical terms above ubiquitous firm boilerplate", () => {
    const hits = retrieve(index, "add a sentence about wastewater treatment work");
    expect(hits[0].text).toContain("wastewater treatment plant");
  });

  it("returns at most k entries and only entries with term overlap", () => {
    const hits = retrieve(index, "bridge hydraulic replacement", 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain("Bridge replacement");
  });

  it("returns nothing when no meaningful term matches", () => {
    expect(retrieve(index, "zzz qqq")).toHaveLength(0);
  });
});
