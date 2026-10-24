import { describe, it, expect } from "vitest";
import { mergeVisuals, orderBody, swipeStep, SWIPE_DISTANCE, SWIPE_TIME } from "../../public/js/visual-order.js";

describe("mergeVisuals", () => {
  it("puts every kind in the order they share", () => {
    const merged = mergeVisuals({
      media: [{ id: "a", position: 2 }, { id: "b", position: 0 }],
      drawing: [{ id: "c", position: 3 }],
      pose: [{ id: "d", position: 1 }],
    });
    expect(merged.map((v) => [v.kind, v.item.id])).toEqual([["media", "b"], ["pose", "d"], ["media", "a"], ["drawing", "c"]]);
  });

  it("settles ties from before the order was shared: photos, drawings, poses, then oldest first", () => {
    const merged = mergeVisuals({
      media: [{ id: "a", position: 0 }, { id: "b", position: 1 }],
      drawing: [{ id: "c", position: 0, created_at: "2026-10-02T00:00:00Z" }, { id: "e", position: 0, created_at: "2026-10-01T00:00:00Z" }],
      pose: [{ id: "d", position: 0 }],
    });
    expect(merged.map((v) => v.item.id)).toEqual(["a", "e", "c", "d", "b"]);
  });

  it("makes the order to save", () => {
    expect(orderBody(/** @type {any[]} */ ([{ kind: "pose", id: "d", data: {} }, { kind: "media", id: "a" }]))).toEqual([{ kind: "pose", id: "d" }, { kind: "media", id: "a" }]);
  });
});

describe("swipeStep", () => {
  it("goes to the next visual on a swipe left, and the one before on a swipe right", () => {
    expect(swipeStep(-SWIPE_DISTANCE, 0, 200)).toBe(1);
    expect(swipeStep(SWIPE_DISTANCE + 30, 20, 200)).toBe(-1);
  });

  it("ignores short, slow or mostly up-and-down movements", () => {
    expect(swipeStep(-(SWIPE_DISTANCE - 1), 0, 200)).toBe(0);
    expect(swipeStep(-200, 0, SWIPE_TIME + 1)).toBe(0);
    expect(swipeStep(-80, 70, 200)).toBe(0);
    expect(swipeStep(0, 0, 0)).toBe(0);
  });
});
