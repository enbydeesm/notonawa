// The feet under gravity (pose-gravity.js): flat on the floor, onto the
// ball of the foot as the heel lifts, en pointe once a change takes them
// out of reach; left alone when the change didn't move them, or the shin
// doesn't point down.
import { describe, it, expect } from "vitest";
import { makeSkeleton } from "../../public/js/pose-skeleton.js";
import { grounded } from "../../public/js/pose-gravity.js";
import { newPose, setLift, setJoint, setBody } from "../../public/js/pose-format.js";
import { jointNamed } from "../../public/js/figure-rig.js";

const POINTED = /** @type {import("../../public/js/figure-rig.js").Joint} */ (jointNamed("l_ankle")).moves[0].min;
/** @param {import("../../public/js/pose-format.js").Pose} p */
const feet = (p) => [p.joints.l_ankle[0], p.joints.l_toes[0], p.joints.r_ankle[0], p.joints.r_toes[0]];

describe("the feet under gravity", () => {
  it("stay flat on the floor standing, and land flat when lowered back", () => {
    const skeleton = makeSkeleton();
    const standing = newPose();
    expect(feet(grounded(skeleton, standing, setLift(standing, standing.lift - 2)))).toEqual([0, 0, 0, 0]);
    const tiptoe = grounded(skeleton, standing, setLift(standing, standing.lift + 4));
    expect(feet(grounded(skeleton, tiptoe, setLift(tiptoe, standing.lift)))).toEqual([0, 0, 0, 0]);
  });

  it("rise onto the balls of the feet as the body lifts a little, the toes bent up to stay on the floor", () => {
    const skeleton = makeSkeleton();
    const standing = newPose();
    const [ankle, toes, rAnkle, rToes] = feet(grounded(skeleton, standing, setLift(standing, standing.lift + 4)));
    expect(ankle).toBeLessThan(0);
    expect(ankle).toBeGreaterThan(POINTED);
    expect(toes).toBeGreaterThan(0);
    expect([rAnkle, rToes]).toEqual([ankle, toes]);
    // Higher, pointed further.
    const higher = feet(grounded(skeleton, standing, setLift(standing, standing.lift + 8)));
    expect(higher[0]).toBeLessThan(ankle);
  });

  it("go en pointe once lifted off the floor, then are mine until they come back down", () => {
    const skeleton = makeSkeleton();
    const standing = newPose();
    const up = grounded(skeleton, standing, setLift(standing, standing.lift + 40));
    expect(feet(up)).toEqual([POINTED, 0, POINTED, 0]);
    // An ankle set by hand in the air stays when the body moves on up.
    const mine = setJoint(up, "l_ankle", 0, -20);
    expect(grounded(skeleton, mine, setLift(mine, mine.lift + 10)).joints.l_ankle).toEqual([-20]);
  });

  it("are left as they are when the change doesn't move them", () => {
    const skeleton = makeSkeleton();
    const standing = setJoint(newPose(), "l_ankle", 0, 20);
    const arm = setJoint(standing, "l_shoulder", 0, 90);
    expect(grounded(skeleton, standing, arm)).toBe(arm);
  });

  it("leave a foot alone when its shin doesn't point down (lying down)", () => {
    const skeleton = makeSkeleton();
    const lying = setLift(setBody(setJoint(newPose(), "l_ankle", 0, 20), 0, 90), 20);
    const moved = setLift(lying, 25);
    expect(grounded(skeleton, lying, moved).joints.l_ankle).toEqual([20]);
  });

  it("lift one foot onto its ball as its knee bends forward, the other left flat", () => {
    const skeleton = makeSkeleton();
    const standing = newPose();
    const bent = grounded(skeleton, standing, setJoint(setJoint(standing, "l_hip", 0, 20), "l_knee", 0, 30));
    expect(bent.joints.r_ankle).toEqual([0]);
    expect(bent.joints.l_ankle[0]).not.toBe(0);
  });
});
