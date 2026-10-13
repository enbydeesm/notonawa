import { describe, it, expect } from "vitest";
import { parseTagNames, matchTags, MAX_TAGS, MAX_TAG_LENGTH } from "../../src/tags/parse.js";

describe("parseTagNames", () => {
  it("trims, drops blanks, and keeps names that differ only by capitals once", () => {
    expect(parseTagNames([" Futomomo ", "", "  ", "futomomo", "Floor"])).toEqual(["Futomomo", "Floor"]);
  });

  it("treats a missing list as no tags", () => {
    expect(parseTagNames(undefined)).toEqual([]);
    expect(parseTagNames(null)).toEqual([]);
  });

  it("drops anything that isn't text", () => {
    expect(parseTagNames(["Floor", 3, null, { name: "x" }])).toEqual(["Floor"]);
  });

  it("rejects a non-list and too many tags", () => {
    expect(() => parseTagNames("Floor")).toThrow(`Tags should be a list of up to ${MAX_TAGS} tags.`);
    expect(() => parseTagNames(Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`))).toThrow("up to");
    expect(parseTagNames(Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`))).toHaveLength(MAX_TAGS);
  });

  it("rejects a name that's too long", () => {
    expect(() => parseTagNames(["x".repeat(MAX_TAG_LENGTH + 1)])).toThrow(`Keep tags to ${MAX_TAG_LENGTH} characters or fewer.`);
    expect(parseTagNames(["x".repeat(MAX_TAG_LENGTH)])).toHaveLength(1);
  });
});

describe("matchTags", () => {
  const existing = [{ id: "1", name: "Futomomo" }, { id: "2", name: "floor" }, { id: "3", name: "Floor" }];

  it("uses an existing tag's spelling when only capitals differ", () => {
    expect(matchTags(existing, ["FUTOMOMO"])).toEqual([{ name: "Futomomo", isNew: false }]);
  });

  it("prefers an exact match", () => {
    expect(matchTags(existing, ["Floor", "floor"])).toEqual([{ name: "Floor", isNew: false }, { name: "floor", isNew: false }]);
  });

  it("marks names with no match as new", () => {
    expect(matchTags(existing, ["Suspension"])).toEqual([{ name: "Suspension", isNew: true }]);
  });
});
