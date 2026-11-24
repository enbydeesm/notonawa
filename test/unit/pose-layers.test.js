// Layers, points added beside a chosen one, and see-through ropes
// (pose-format.js, pose-points.js, the server's checks).
import { describe, it, expect } from "vitest";
import * as page from "../../public/js/pose-format.js";
import * as server from "../../src/poses/parse.js";
import { makeSkeleton, posed, ropePoint } from "../../public/js/pose-skeleton.js";
import { besidePoint, addBeside, BESIDE_CM } from "../../public/js/pose-points.js";

/** @typedef {import("../../public/js/pose-format.js").Pose} Pose */
/** @typedef {import("../../public/js/pose-format.js").Rope} Rope */
/** @typedef {import("../../public/js/pose-format.js").RopePoint} RopePoint */

/** @param {RopePoint[]} p @param {Partial<Rope>} [more] @returns {Rope} */
const rope = (p, more = {}) => ({ c: "red", w: 2, p, ...more });
const skeleton = makeSkeleton();
/** @param {Pose} pose @param {RopePoint} point */
const at = (pose, point) => {
  posed(skeleton, pose);
  return ropePoint(skeleton, point, pose);
};
/** Round the front of the chest: three points 10 cm apart, across it. @type {[string, number, number, number][]} */
const FRONT = [["chest", -100, 50, 120], ["chest", 0, 50, 130], ["chest", 100, 50, 120]];

describe("a point's layer", () => {
  it("puts it that many ropes' thickness out from the skin", () => {
    const pose = page.newPose();
    const skin = at(pose, FRONT[1]);
    for (const layer of [1, 2, 4]) {
      const out = at(pose, page.withLayer(FRONT[1], layer));
      expect(out.distanceTo(skin)).toBeCloseTo(layer * page.LAYER_CM, 1);
    }
  });

  it("is 0 to 4, kept only when above 0, and stays with a point that's moved", () => {
    expect(page.layerOf(FRONT[0])).toBe(0);
    expect(page.withLayer(FRONT[0], 2)).toEqual([...FRONT[0], 2]);
    expect(page.withLayer(FRONT[0], 9)).toEqual([...FRONT[0], 4]);
    expect(page.withLayer([...FRONT[0], 3], 0)).toEqual(FRONT[0]);
    const pose = { ...page.newPose(), ropes: [rope(FRONT)] };
    const up = page.setLayer(pose, 0, 1, 2);
    expect(up.ropes[0].p[1]).toEqual([...FRONT[1], 2]);
    expect(page.setLayer(up, 0, 1, -1).ropes[0].p[1]).toEqual(FRONT[1]);
    const moved = page.movePoint(up, 0, 1, page.bonePoint("chest", [0, 60, 130]));
    expect(moved.ropes[0].p[1]).toEqual(["chest", 0, 60, 130, 2]);
  });

  it("is saved on a point on the body only, 1 to 4; older points read as on the skin", () => {
    const pose = { ...page.newPose(), ring: [0, 250, 0], ropes: [rope([[...FRONT[0], 2], FRONT[1], ["ring", 0, 0, 0]])] };
    expect(server.parsePose(pose)).toEqual(pose);
    const badly = (/** @type {RopePoint} */ point) => ({ ...pose, ropes: [rope([point, FRONT[1]])] });
    expect(() => server.parsePose(badly([...FRONT[0], 5]))).toThrow(/right format/);
    expect(() => server.parsePose(badly([...FRONT[0], 1.5]))).toThrow(/right format/);
    expect(() => server.parsePose({ ...pose, ropes: [rope([FRONT[0], ["ring", 0, 0, 0, 1]])] })).toThrow(/right format/);
    // A layer of 0 isn't kept.
    expect(server.parsePose(badly([...FRONT[0], 0])).ropes[0].p[0]).toEqual(FRONT[0]);
  });
});

describe("a point added beside a chosen one", () => {
  it("goes 5 cm along the rope toward the next point, or halfway when that's nearer, at the chosen point's layer", () => {
    const pose = { ...page.newPose(), ropes: [rope([[...FRONT[0], 1], FRONT[1], ["chest", 0, 50, 160]])] };
    posed(skeleton, pose);
    const far = /** @type {import("../../public/js/pose-points.js").Beside} */ (besidePoint(skeleton, pose, 0, 0, 1));
    expect(far.j).toBe(1);
    expect(page.layerOf(far.point)).toBe(1);
    const flatAt = ropePoint(skeleton, /** @type {RopePoint} */ (far.point.slice(0, 4)), pose);
    expect(flatAt.distanceTo(ropePoint(skeleton, FRONT[0], pose))).toBeGreaterThan(BESIDE_CM - 1);
    expect(flatAt.distanceTo(ropePoint(skeleton, FRONT[0], pose))).toBeLessThan(BESIDE_CM + 0.5);
    // The last two points are 3 cm apart: halfway.
    const near = /** @type {import("../../public/js/pose-points.js").Beside} */ (besidePoint(skeleton, pose, 0, 2, -1));
    expect(near.j).toBe(2);
    expect(ropePoint(skeleton, near.point, pose).distanceTo(ropePoint(skeleton, FRONT[1], pose))).toBeCloseTo(1.5, 0);
    // None past either end.
    expect(besidePoint(skeleton, pose, 0, 0, -1)).toBeNull();
    expect(besidePoint(skeleton, pose, 0, 2, 1)).toBeNull();
  });

  it("keeps what's tied to the rope where it was: a spot on a later stretch moves up one, one on the split stretch to its half", () => {
    const pose = {
      ...page.newPose(), ring: [0, 250, 30],
      ropes: [rope(FRONT), rope([page.ropeSpot(0, 1, 0.6), ["ring", 0, 0, 0]]), rope([page.ropeSpot(0, 0, 0.3), ["ring", 0, 0, 0]])],
    };
    const was = [at(pose, pose.ropes[1].p[0]), at(pose, pose.ropes[2].p[0])];
    // Halfway between the first two, on the straight line a spot is measured on.
    const middle = /** @type {RopePoint} */ (["chest", -50, 50, 125]);
    const added = page.insertPoint(pose, 0, 1, middle, 0.5);
    expect(added.ropes[0].p).toEqual([FRONT[0], middle, FRONT[1], FRONT[2]]);
    expect(added.ropes[1].p[0]).toEqual(page.ropeSpot(0, 2, 0.6));
    expect(added.ropes[2].p[0]).toEqual(page.ropeSpot(0, 0, 0.6));
    expect(at(added, added.ropes[1].p[0]).distanceTo(was[0])).toBeLessThan(0.1);
    expect(at(added, added.ropes[2].p[0]).distanceTo(was[1])).toBeLessThan(0.1);
    expect(server.parsePose(added)).toEqual(added);
  });

  it("is chosen next (its index), and nothing's added when there's no room", () => {
    const pose = { ...page.newPose(), ropes: [rope(FRONT)] };
    posed(skeleton, pose);
    const before = addBeside(skeleton, pose, 0, 1, -1);
    expect(before.k).toBe(1);
    expect(before.pose.ropes[0].p).toHaveLength(4);
    expect(before.pose.ropes[0].p[2]).toEqual(FRONT[1]);
    const after = addBeside(skeleton, pose, 0, 1, 1);
    expect(after.k).toBe(2);
    expect(addBeside(skeleton, pose, 0, 2, 1)).toEqual({ pose, k: 2 });
  });
});

describe("a see-through rope", () => {
  it("is marked t, saved and read back, and solid again without it", () => {
    const pose = { ...page.newPose(), ropes: [rope(FRONT)] };
    const clear = page.setSeeThrough(pose, 0, true);
    expect(clear.ropes[0].t).toBe(true);
    expect(server.parsePose(clear)).toEqual(clear);
    expect(page.forSaving(clear).ropes[0].t).toBe(true);
    expect(page.readPose(clear).ropes[0].t).toBe(true);
    expect("t" in page.setSeeThrough(clear, 0, false).ropes[0]).toBe(false);
    expect(() => server.parsePose({ ...pose, ropes: [{ ...pose.ropes[0], t: 1 }] })).toThrow(/right format/);
  });
});
