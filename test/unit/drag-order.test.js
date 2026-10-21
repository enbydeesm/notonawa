// Dragging photos into order: the pure parts (public/js/drag-order.js).
// The pointer handling (photos-ui.js) is covered by the UI walkthrough.
import { describe, it, expect } from "vitest";
import { movedFar, slotAt, moveItem, DRAG_PX } from "../../public/js/drag-order.js";

describe("movedFar", () => {
  it("counts a move of DRAG_PX or more in any direction", () => {
    expect(movedFar({ x: 10, y: 10 }, { x: 10 + DRAG_PX, y: 10 })).toBe(true);
    expect(movedFar({ x: 10, y: 10 }, { x: 10, y: 10 - DRAG_PX })).toBe(true);
    expect(movedFar({ x: 10, y: 10 }, { x: 16, y: 16 })).toBe(true);
  });
  it("treats a small wobble as a tap", () => {
    expect(movedFar({ x: 10, y: 10 }, { x: 12, y: 13 })).toBe(false);
    expect(movedFar({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
  });
});

describe("slotAt", () => {
  // Three tiles in a row, 100 wide with 10 between, and a fourth below.
  const boxes = [
    { left: 0, top: 0, right: 100, bottom: 100 },
    { left: 110, top: 0, right: 210, bottom: 100 },
    { left: 220, top: 0, right: 320, bottom: 100 },
    { left: 0, top: 110, right: 100, bottom: 210 },
  ];
  it("finds the tile the point is on", () => {
    expect(slotAt(boxes, { x: 50, y: 50 })).toBe(0);
    expect(slotAt(boxes, { x: 200, y: 5 })).toBe(1);
    expect(slotAt(boxes, { x: 1, y: 209 })).toBe(3);
  });
  it("takes the nearest tile from a gap or past the end", () => {
    expect(slotAt(boxes, { x: 106, y: 50 })).toBe(1);
    expect(slotAt(boxes, { x: 400, y: 50 })).toBe(2);
    expect(slotAt(boxes, { x: 300, y: 200 })).toBe(2);
    expect(slotAt(boxes, { x: 140, y: 190 })).toBe(3);
  });
  it("is -1 with no tiles", () => {
    expect(slotAt([], { x: 0, y: 0 })).toBe(-1);
  });
});

describe("moveItem", () => {
  it("moves an item later, shifting the ones between back", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });
  it("moves an item earlier, shifting the ones between along", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("leaves the list as it was for the same place or one out of range, and never changes the original", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 1, 1)).toEqual(list);
    expect(moveItem(list, 1, 3)).toEqual(list);
    expect(moveItem(list, -1, 0)).toEqual(list);
    expect(moveItem(list, 0, 2)).not.toBe(list);
    expect(list).toEqual(["a", "b", "c"]);
  });
});
