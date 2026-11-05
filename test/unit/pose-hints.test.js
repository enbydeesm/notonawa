import { describe, it, expect } from "vitest";
import { viewHint, ropeHint, hardpointLostNote } from "../../public/js/pose-hints.js";

/** @param {Partial<Parameters<typeof ropeHint>[0]>} over */
const rope = (over) => ropeHint({ erasing: false, layingKind: "rope", points: 0, chosen: "none", sliding: false, hardpoint: null, ...over });

describe("viewHint", () => {
  const base = { tab: /** @type {const} */ ("pose"), drawing: false, laying: false, chosen: false };
  it("follows the tab", () => {
    expect(viewHint(base)).toBe("Drag head for height · tap for whole body");
    expect(viewHint({ ...base, tab: "scene" })).toBe("Drag to turn · 2 fingers to pan · pinch to zoom");
    expect(viewHint({ ...base, tab: "rope" })).toBe("Drag to turn · 2 fingers to pan · pinch to zoom");
  });
  it("says how to let a chosen rope go, or to keep tapping while laying one", () => {
    expect(viewHint({ ...base, tab: "rope", chosen: true })).toBe("Tap anywhere else to let it go");
    expect(viewHint({ ...base, tab: "rope", laying: true, chosen: true })).toBe("Keep tapping to add points");
  });
  it("the pencil wins over any tab", () => {
    for (const tab of /** @type {const} */ (["pose", "rope", "scene"])) {
      expect(viewHint({ ...base, tab, drawing: true })).toBe("Draw with a finger");
    }
  });
});

describe("ropeHint", () => {
  it("counts the points of what's being laid", () => {
    expect(rope({ points: 1 })).toBe("Rope: 1 point. Keep tapping, then Finish.");
    expect(rope({ layingKind: "cinch", points: 2 })).toMatch(/^Cinch: 2 points\./);
    expect(rope({ layingKind: "added", points: 3 })).toBe("Added rope: 3 points. Keep tapping, then Finish.");
  });
  it("the eraser comes first", () => {
    expect(rope({ erasing: true, points: 2 })).toBe("Tap a rope to take it out.");
  });
  it("a chosen rope: its actions, sliding, or a cinch", () => {
    expect(rope({ chosen: "rope" })).toBe("Cinch and Add rope start from the dot.");
    expect(rope({ chosen: "rope", sliding: true })).toBe("Tap Slide again when it's in place.");
    expect(rope({ chosen: "cinch" })).toMatch(/Tap Cinch again when you're done\.$/);
  });
  it("nothing chosen: what to tap, for the hardpoint there", () => {
    expect(rope({ hardpoint: "bamboo" })).toBe("Tap the body to lay a rope. Tap the bamboo for an upline, or a rope to choose it.");
    expect(rope({ hardpoint: "hashira" })).toBe("Tap the body to lay a rope. Tap the hashira to tie to it, or a rope to choose it.");
    expect(rope({})).toBe("Tap the body to lay a rope, point by point.");
  });
});

describe("hardpointLostNote", () => {
  it("is empty when no rope points went", () => {
    expect(hardpointLostNote("ring", 0)).toBe("");
  });
  it("counts what went and says Undo brings it back", () => {
    expect(hardpointLostNote("bamboo", 1)).toBe("1 rope point on the bamboo went with it. Undo brings it back.");
    expect(hardpointLostNote("ring", 4)).toBe("4 rope points on the ring went with it. Undo brings them back.");
  });
});
