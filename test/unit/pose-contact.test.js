// Keeping limbs out of the body (pose-contact.js): a move is shown with
// the parts it pushes into each other, and settled when it's let go:
// another limb or the head moves aside, a limb pushed into the trunk
// comes back out, and nothing already touching before the move counts.
import { describe, it, expect } from "vitest";
import { Vector3 } from "../../public/js/vendor/three.js";
import { makeSkeleton, posed } from "../../public/js/pose-skeleton.js";
import { segmentGap, capsules, clashingParts, settleClashes, behindBody, skinGive } from "../../public/js/pose-contact.js";
import { SEGMENTS } from "../../public/js/figure-body.js";
import { newPose, setJoint, setHardpoint, HASHIRA_SIZE } from "../../public/js/pose-format.js";

/** @typedef {import("../../public/js/pose-format.js").Pose} Pose */

/** @param {Pose} p @param {string} j @param {number} i @param {number} v */
const J = (p, j, i, v) => setJoint(p, j, i, v);

/** The joints a settle changed from the move. @param {Pose} after @param {Pose} settled */
const changed = (after, settled) => Object.keys(settled.joints).filter((j) => settled.joints[j].join() !== after.joints[j].join());

describe("the body as capsules", () => {
  it("measures the gap between two segments", () => {
    const v = (/** @type {number[]} */ p) => new Vector3(...p);
    expect(segmentGap(v([0, 0, 0]), v([10, 0, 0]), v([5, 3, 0]), v([5, 3, 10]))).toBeCloseTo(3);
    expect(segmentGap(v([0, 0, 0]), v([10, 0, 0]), v([12, 0, 0]), v([20, 0, 0]))).toBeCloseTo(2);
    expect(segmentGap(v([0, 0, 0]), v([0, 0, 0]), v([1, 1, 0]), v([1, 1, 0]))).toBeCloseTo(Math.SQRT2);
  });

  it("has a capsule for every segment, three side by side for the torso", () => {
    const skeleton = makeSkeleton();
    posed(skeleton, newPose());
    const caps = capsules(skeleton);
    expect(caps.length).toBe(SEGMENTS.length);
    for (const [i, seg] of SEGMENTS.entries()) {
      expect(caps[i].length, seg.name).toBe(["hips", "waist", "chest"].includes(seg.name) ? 3 : 1);
      for (const c of caps[i]) expect(c.r, seg.name).toBeGreaterThan(2);
    }
  });
});

describe("clashes", () => {
  it("leaves a move that pushes nothing in as it is", () => {
    const skeleton = makeSkeleton();
    const start = newPose();
    const raised = J(start, "l_shoulder", 0, 90);
    expect(clashingParts(skeleton, start, raised).size).toBe(0);
    expect(settleClashes(skeleton, start, raised, ["l_shoulder"])).toBe(raised);
  });

  it("doesn't count what was already touching (hands at the thighs)", () => {
    const skeleton = makeSkeleton();
    const start = newPose();
    const kneeBent = J(start, "r_knee", 0, 20);
    expect(clashingParts(skeleton, start, kneeBent).size).toBe(0);
  });

  it("brings a forearm folded into the belly back out, moving nothing else", () => {
    const skeleton = makeSkeleton();
    const before = J(J(newPose(), "l_shoulder", 0, 20), "l_shoulder", 2, -80);
    const after = J(before, "l_elbow", 0, 150);
    const clash = clashingParts(skeleton, before, after);
    expect(clash.has("l_wrist")).toBe(true);
    expect([...clash].some((p) => ["pelvis", "spine", "chest"].includes(p))).toBe(true);
    const settled = settleClashes(skeleton, before, after, ["l_elbow"]);
    expect(clashingParts(skeleton, before, settled).size).toBe(0);
    expect(changed(after, settled)).toEqual(["l_elbow"]);
    expect(settled.joints.l_elbow[0]).toBeLessThan(150);
    expect(settled.joints.l_elbow[0]).toBeGreaterThan(20);
  });

  it("moves the other arm aside when one is swung into it, leaving the one moved where it was put", () => {
    const skeleton = makeSkeleton();
    const before = J(J(J(newPose(), "l_shoulder", 0, 90), "r_shoulder", 0, 90), "r_shoulder", 2, -90);
    const after = J(before, "r_elbow", 0, 90);
    expect(clashingParts(skeleton, before, after).has("r_wrist")).toBe(true);
    const settled = settleClashes(skeleton, before, after, ["r_elbow"]);
    expect(clashingParts(skeleton, before, settled).size).toBe(0);
    expect(settled.joints.r_elbow).toEqual([90, 0]);
    expect(changed(after, settled).every((j) => j.startsWith("l_"))).toBe(true);
  });

  it("tilts the head away a little from a hand folded into it, the arm doing the rest", () => {
    const skeleton = makeSkeleton();
    const before = J(J(J(newPose(), "l_shoulder", 0, 90), "l_shoulder", 1, 0), "l_shoulder", 2, -20);
    const after = J(before, "l_elbow", 0, 120);
    expect(clashingParts(skeleton, before, after).has("head")).toBe(true);
    const settled = settleClashes(skeleton, before, after, ["l_elbow"]);
    expect(clashingParts(skeleton, before, settled).size).toBe(0);
    for (const a of settled.joints.head) expect(Math.abs(a)).toBeLessThanOrEqual(20);
    expect(changed(after, settled).every((j) => j === "head" || j === "l_elbow")).toBe(true);
  });
});

describe("behindBody", () => {
  /** The gap from the furthest-back capsule of the trunk to the post's face, along the body's facing. */
  const gapBehind = (/** @type {Pose} */ pose, /** @type {number[]} */ [, z]) => {
    const skeleton = makeSkeleton();
    posed(skeleton, pose);
    const caps = capsules(skeleton);
    const torso = ["hips", "waist", "chest"].map((n) => SEGMENTS.findIndex((s) => s.name === n));
    let back = Infinity;
    for (const i of torso) for (const c of caps[i]) for (const p of [c.a, c.b]) back = Math.min(back, p.z - c.r);
    return back - (z + HASHIRA_SIZE.width / 2);
  };

  it("puts a new hashira about 3 cm behind a standing body", () => {
    const pose = newPose();
    const place = /** @type {number[]} */ (behindBody(makeSkeleton(), pose));
    expect(place).not.toBeNull();
    expect(Math.abs(place[0])).toBeLessThanOrEqual(1);
    expect(place[2]).toBe(0);
    expect(gapBehind(pose, place)).toBeGreaterThan(2);
    expect(gapBehind(pose, place)).toBeLessThan(4);
    expect(setHardpoint(pose, "hashira", place).hashira).toEqual(place);
  });

  it("follows the body when it's moved and turned", () => {
    const at = (/** @type {Partial<Pose>} */ o) => behindBody(makeSkeleton(), { ...newPose(), ...o });
    const [, z] = /** @type {number[]} */ (at({}));
    // Moved across, it moves with it.
    expect(at({ shift: [40, 0] })).toEqual([40, z, 0]);
    // Turned a quarter, "behind" is off to the side, as far, and the
    // square post needs no turn; a third of that, it turns to face the back.
    const turned = /** @type {number[]} */ (at({ body: [0, 90, 0] }));
    expect(turned[0]).toBeCloseTo(z, 0);
    expect(Math.abs(turned[1])).toBeLessThanOrEqual(1);
    expect(at({ body: [0, 30, 0] })?.[2]).toBe(30);
  });

  it("leaves the usual place for a body lying face down", () => {
    const pose = { ...newPose(), body: /** @type {[number, number, number]} */ ([90, 0, 0]) };
    expect(behindBody(makeSkeleton(), pose)).toBeNull();
  });
});

describe("skinGive", () => {
  it("lets an arm into the trunk further than other parts, and furthest at the back", () => {
    const facing = new Vector3(0, 0, 1);
    expect(skinGive(false, new Vector3(0, 0, -1), facing)).toBe(1.5);
    expect(skinGive(true, new Vector3(0, 0, 1), facing)).toBe(3);
    expect(skinGive(true, new Vector3(1, 0, 0.2), facing)).toBe(3);
    expect(skinGive(true, new Vector3(0.3, 0, -1), facing)).toBe(5);
  });
});
