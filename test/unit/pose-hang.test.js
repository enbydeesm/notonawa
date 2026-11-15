// A body in the air hanging under its lines (pose-hang.js).
import { describe, it, expect } from "vitest";
import * as page from "../../public/js/pose-format.js";
import * as server from "../../src/poses/parse.js";
import { makeSkeleton, posed, ropePoint } from "../../public/js/pose-skeleton.js";
import { segmentLength } from "../../public/js/pose-cinch.js";
import { lowestSkin } from "../../public/js/pose-uplines.js";
import { hang, canHang, weightMiddle } from "../../public/js/pose-hang.js";

/** @typedef {import("../../public/js/pose-format.js").Pose} Pose */
/** @typedef {import("../../public/js/pose-format.js").Rope} Rope */
/** @typedef {import("../../public/js/pose-format.js").RopePoint} RopePoint */

/** @param {RopePoint[]} p @param {Partial<Rope>} [more] @returns {Rope} */
const rope = (p, more = {}) => ({ c: "red", w: 2, p, ...more });
/** @type {RopePoint} */
const RING = ["ring", 0, 0, 0];
const skeleton = makeSkeleton();
/** @param {Pose} pose */
const weight = (pose) => {
  posed(skeleton, pose);
  return weightMiddle(skeleton);
};
/** @param {Pose} pose @param {number} index */
const taut = (pose, index) => {
  posed(skeleton, pose);
  return segmentLength(skeleton, pose, index, 0);
};
/** @param {Pose} pose */
const low = (pose) => {
  posed(skeleton, pose);
  return lowestSkin(skeleton);
};

/** Face down, 110 cm up, under a ring. @param {Rope[]} ropes @returns {Pose} */
const faceDown = (ropes) => ({ ...page.newPose(), body: [90, 0, 0], lift: 110, ring: [0, 195, 0], ropes });
const CHEST = rope([["chest", 0, 0, 0], RING]);
const HIPS = rope([["pelvis", 0, 0, -100], RING]);

describe("the body's weight", () => {
  it("sits in the belly of a standing body, and lower and further forward on a heavier one's", () => {
    const standing = page.newPose();
    const middle = weight(standing);
    expect(Math.abs(middle.x)).toBeLessThan(1);
    expect(middle.y).toBeGreaterThan(95);
    expect(middle.y).toBeLessThan(125);
    const heavier = weight(page.setShape(standing, [50, 50, 100, 184]));
    expect(heavier.z).toBeGreaterThan(middle.z);
  });
});

describe("a body hanging", () => {
  it("is left alone on the floor, and with no upline", () => {
    const standing = { ...page.newPose(), ring: [0, 250, 0], ropes: [CHEST] };
    expect(canHang(standing)).toBe(false);
    expect(hang(standing)).toBe(standing);
    const loose = { ...page.newPose(), lift: 150, ring: [0, 250, 0], ropes: [rope([["chest", 0, 0, 0], ["spine", 0, 0, 0]])] };
    expect(canHang(loose)).toBe(false);
    expect(hang(loose)).toBe(loose);
    expect(canHang({ ...standing, lift: 130 })).toBe(true);
  });

  it("on one line, swings under the hardpoint, the line as long as it was and the joints as posed", () => {
    /** @type {Pose} */
    const pose = { ...page.newPose(), lift: 130, ring: [40, 250, 0], ropes: [CHEST] };
    const hung = hang(pose);
    const middle = weight(hung);
    // Plumb, near enough: the weight within a few centimetres of under the
    // ring, 40 cm across (the last few gain too little height to find).
    expect(Math.abs(middle.x - 40)).toBeLessThan(6);
    expect(Math.abs(middle.z)).toBeLessThan(4);
    expect(middle.y).toBeLessThan(weight(pose).y - 5);
    expect(Math.abs(taut(hung, 0) - taut(pose, 0))).toBeLessThan(1.5);
    expect(hung.joints).toEqual(pose.joints);
    // The line runs straight up from where it's tied.
    posed(skeleton, hung);
    expect(Math.abs(ropePoint(skeleton, hung.ropes[0].p[0], hung).x - 40)).toBeLessThan(6);
    // At rest: hanging again changes nothing.
    expect(hang(hung)).toBe(hung);
    // A pose the server takes.
    expect(() => server.parsePose(page.forSaving(hung))).not.toThrow();
  });

  it("on two lines, comes to the balance between them, both as long as they were", () => {
    const pose = faceDown([CHEST, HIPS]);
    const hung = hang(pose);
    expect(Math.abs(weight(hung).z)).toBeLessThan(5);
    expect(weight(hung).y).toBeLessThan(weight(pose).y);
    for (const i of [0, 1]) expect(Math.abs(taut(hung, i) - taut(pose, i))).toBeLessThan(1.5);
    // At rest: hanging again changes nothing.
    expect(hang(hung)).toBe(hung);
  });

  it("draws a slack line tight before it holds, its whole length kept", () => {
    const pose = faceDown([CHEST, { ...HIPS, k: 15 }]);
    const hung = hang(pose);
    const whole = taut(pose, 1) + 15;
    expect(taut(hung, 1)).toBeLessThan(whole + 1.5);
    expect(Math.abs(taut(hung, 1) + (hung.ropes[1].k ?? 0) - whole)).toBeLessThan(1.5);
    // Lower than with the hips' line taut from the start.
    expect(weight(hung).y).toBeLessThan(weight(hang(faceDown([CHEST, HIPS]))).y - 3);
  });

  it("never goes into the floor: a body on a long line comes down onto it and stops", () => {
    const pose = faceDown([CHEST]);
    const hung = hang(pose);
    expect(low(hung)).toBeGreaterThanOrEqual(0);
    expect(low(hung)).toBeLessThan(low(pose));
    expect(Math.abs(taut(hung, 0) - taut(pose, 0))).toBeLessThan(1.5);
  });

  it("leaves a see-saw rope out: it runs free, so it holds nothing", () => {
    const pose = { ...page.newPose(), lift: 150, ring: [0, 250, 0], ropes: [rope([["l_wrist", 0, 0, 0], RING, ["r_wrist", 0, 0, 0]], { s: true })] };
    expect(canHang(pose)).toBe(false);
  });
});
