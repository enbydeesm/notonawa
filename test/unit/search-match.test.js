import { describe, it, expect } from "vitest";
import { matchingTies, normaliseKeyword } from "../../public/js/search-match.js";

const INDEX = [
  { id: "a", title: "Floor session", notes: "Tried a new hip harness", plan_titles: [] },
  { id: "b", title: null, notes: "Größe passt, Öse hält", plan_titles: ["TK"] },
  { id: "c", title: "Suspension", notes: null, plan_titles: ["Futomomo", "Hip harness"] },
];

describe("matchingTies", () => {
  it("finds a keyword in the title, the notes or a linked plan's title, ignoring capitals", () => {
    expect(matchingTies(INDEX, "HIP HARNESS")).toEqual(["a", "c"]);
    expect(matchingTies(INDEX, "floor")).toEqual(["a"]);
    expect(matchingTies(INDEX, "tk")).toEqual(["b"]);
  });

  it("folds capitals in any language: Ö finds ö, and the other way round", () => {
    expect(matchingTies(INDEX, "öse")).toEqual(["b"]);
    expect(matchingTies(INDEX, "GRÖSSE")).toEqual([]);
    expect(matchingTies(INDEX, "GRÖßE")).toEqual(["b"]);
  });

  it("matches nothing for a word that isn't there, and everything for no keyword", () => {
    expect(matchingTies(INDEX, "box tie")).toEqual([]);
    expect(matchingTies(INDEX, "   ")).toEqual(["a", "b", "c"]);
    expect(normaliseKeyword("  Hip ")).toBe("hip");
  });
});
