// Ropes with their lengths locked (pose-constraints.js's keepLocked):
// the parts they tie together move together, or hold against a move.
import { describe, it, expect } from "vitest";
import * as page from "../../public/js/pose-format.js";
import * as server from "../../src/poses/parse.js";
import { makeSkeleton, posed } from "../../public/js/pose-skeleton.js";
import { segmentLength } from "../../public/js/pose-cinch.js";
import { keepLocked, keepRopes, keepSeesaws, lockedStretches, lockedPairs } from "../../public/js/pose-constraints.js";
import { setUplineLength, uplineLength } from "../../public/js/pose-uplines.js";

/** @typedef {import("../../public/js/pose-format.js").Pose} Pose */
/** @typedef {import("../../public/js/pose-format.js").Rope} Rope */
/** @typedef {import("../../public/js/pose-format.js").RopePoint} RopePoint */

/** @param {RopePoint[]} p @param {Partial<Rope>} [more] @returns {Rope} */
const rope = (p, more = {}) => ({ c: "red", w: 2, p, ...more });
const skeleton = makeSkeleton();
/** Every stretch's length. @param {Pose} pose @param {number} index */
const lengths = (pose, index) => {
  posed(skeleton, pose);
  return pose.ropes[index].p.slice(1).map((_, s) => segmentLength(skeleton, pose, index, s));
};

/** Round both thighs, front to front and back to back (a double column). @type {RopePoint[]} */
const THIGHS = [["l_hip", -30, -300, 70], ["r_hip", 30, -300, 70], ["r_hip", 30, -300, -70], ["l_hip", -30, -300, -70]];
/** Thigh to calf on both sides, the knee folded (a futomomo). @type {RopePoint[]} */
const FOLD = [["l_hip", 70, -250, 0], ["l_knee", 70, -150, 0], ["l_knee", -70, -150, 0], ["l_hip", -70, -250, 0]];

describe("locked ropes", () => {
  it("keep the stretches between two parts and to a hardpoint, not those round one part", () => {
    const pose = { ...page.newPose(), ring: [0, 250, 0], ropes: [
      rope(THIGHS, { f: true }), rope([["ring", 0, 0, 0], ["chest", 0, 50, 120], ["chest", 100, 50, 0]], { f: true }), rope(THIGHS),
    ] };
    expect(lockedStretches(pose)).toEqual([
      { index: 0, segment: 0, parts: ["l_hip", "r_hip"] }, { index: 0, segment: 2, parts: ["r_hip", "l_hip"] },
      { index: 1, segment: 0, parts: ["chest"] },
    ]);
    // Points on different parts not next to each other are kept apart too: a bundle.
    expect(lockedPairs(pose)).toEqual([{ index: 0, a: 0, b: 2 }, { index: 0, a: 1, b: 3 }]);
    // A rope being changed itself isn't held to its old lengths.
    expect(lockedStretches(pose, 0).map((s) => s.index)).toEqual([1]);
  });

  it("tying the thighs together: lifting one brings the other with it, the rope as long as it was", () => {
    const before = { ...page.newPose(), ropes: [rope(THIGHS, { f: true })] };
    const moved = page.setJoint(before, "l_hip", 0, 40);
    const after = keepRopes(before, moved, ["l_hip"]);
    expect(after.joints.l_hip[0]).toBe(40);
    expect(after.joints.r_hip[0]).toBeGreaterThan(35);
    const [was, now] = [lengths(before, 0), lengths(after, 0)];
    for (const s of [0, 2]) expect(Math.abs(now[s] - was[s])).toBeLessThan(1);
  });

  it("not locked, the other thigh stays where it was", () => {
    const before = { ...page.newPose(), ropes: [rope(THIGHS)] };
    const moved = page.setJoint(before, "l_hip", 0, 40);
    expect(keepRopes(before, moved, ["l_hip"])).toBe(moved);
  });

  it("a futomomo: the folded knee won't open, the rope holding it", () => {
    const folded = page.setJoint(page.newPose(), "l_knee", 0, 140);
    const before = { ...folded, ropes: [rope(FOLD, { f: true })] };
    const after = keepRopes(before, page.setJoint(before, "l_knee", 0, 80), ["l_knee"]);
    expect(after.joints.l_knee[0]).toBeGreaterThan(130);
    const [was, now] = [lengths(before, 0), lengths(after, 0)];
    for (const s of [0, 2]) expect(Math.abs(now[s] - was[s])).toBeLessThan(1);
  });

  it("raising an upline on one thigh lifts the other with it, tied together", () => {
    const before = {
      ...page.newPose(), ring: [0, 250, 20],
      ropes: [rope(THIGHS, { f: true }), rope([["ring", 0, 0, 0], ["l_hip", 0, -150, 80]])],
    };
    posed(skeleton, before);
    const was = uplineLength(skeleton, before, 1, 0);
    const raised = setUplineLength(before, 1, 0, Math.round(was - 25));
    expect(raised.joints.l_hip[0]).toBeGreaterThan(before.joints.l_hip[0] + 10);
    const after = keepLocked(before, raised, undefined, { except: 1 });
    expect(after.joints.r_hip[0]).toBeGreaterThan(before.joints.r_hip[0] + 10);
    const [l0, l1] = [lengths(before, 0), lengths(after, 0)];
    for (const s of [0, 2]) expect(Math.abs(l1[s] - l0[s])).toBeLessThan(1.5);
  });

  it("a locked rope doesn't run over the hardpoint as a see-saw", () => {
    const ring = { ...page.newPose(), ring: [0, 250, 0] };
    const seesaw = rope([["l_wrist", 0, -30, 0], ["ring", 0, 0, 0], ["r_wrist", 0, -30, 0]], { s: true, f: true });
    const before = { ...ring, ropes: [seesaw] };
    const moved = page.setJoint(before, "l_shoulder", 0, 60);
    // keepSeesaws leaves it (the lock decides).
    expect(keepSeesaws(before, moved, ["l_shoulder"])).toBe(moved);
  });

  it("is saved and read back; the server refuses anything but true", () => {
    const pose = page.setLocked({ ...page.newPose(), ropes: [rope(THIGHS)] }, 0, true);
    expect(pose.ropes[0].f).toBe(true);
    expect(server.parsePose(pose).ropes[0].f).toBe(true);
    expect(page.setLocked(pose, 0, false).ropes[0].f).toBeUndefined();
    expect(() => server.parsePose({ ...pose, ropes: [{ ...pose.ropes[0], f: 1 }] })).toThrow(/right format/);
  });
});
