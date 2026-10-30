// Keeping limbs out of the body (pose-contact.js): a move that pushes a
// limb further in is stopped where it touches; one that doesn't goes ahead.
import { describe, it, expect } from "vitest";
import { Vector3 } from "../../public/js/vendor/three.js";
import { makeSkeleton, posed, onBone } from "../../public/js/pose-skeleton.js";
import { segmentGap, depths, overlap, noDeeper, keptOut, capsules } from "../../public/js/pose-contact.js";
import { SEGMENTS } from "../../public/js/figure-body.js";
import { newPose, setJoint } from "../../public/js/pose-format.js";
import { dragTo } from "../../public/js/pose-ik.js";

/** The left arm bent in toward the belly: forward a little, twisted in. */
const bentIn = () => setJoint(setJoint(newPose(), "l_shoulder", 0, 20), "l_shoulder", 2, -80);

describe("keeping limbs out of the body", () => {
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

  it("lets through a move that pushes no limb further in", () => {
    const skeleton = makeSkeleton();
    const start = newPose();
    const raised = setJoint(start, "l_shoulder", 0, 90);
    expect(keptOut(skeleton, start, raised)).toEqual(raised);
  });

  it("stops a forearm bending into the belly where it touches", () => {
    const skeleton = makeSkeleton();
    const start = bentIn();
    const folded = setJoint(start, "l_elbow", 0, 150);
    expect(noDeeper(depths(skeleton, folded), depths(skeleton, start))).toBe(false);
    const stopped = keptOut(skeleton, start, folded);
    expect(stopped.joints.l_elbow[0]).toBeGreaterThan(20);
    expect(stopped.joints.l_elbow[0]).toBeLessThan(150);
    expect(noDeeper(depths(skeleton, stopped), depths(skeleton, start))).toBe(true);
  });

  it("stops a dragged hand at the belly", () => {
    const skeleton = makeSkeleton();
    const start = bentIn();
    posed(skeleton, start);
    // Through the middle of the body, at the waist.
    const moved = dragTo(start, "l_wrist", [0, -8.5, 0], new Vector3(0, 110, -5));
    posed(skeleton, moved);
    expect(onBone(skeleton, "l_wrist", [0, -8.5, 0]).z).toBeGreaterThan(5);
    expect(overlap(skeleton, moved)).toBeLessThanOrEqual(overlap(skeleton, start) + 0.1 * SEGMENTS.length);
  });
});
