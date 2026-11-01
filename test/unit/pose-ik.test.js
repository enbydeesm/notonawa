// Dragging a limb (pose-ik.js): the point held goes where it's dragged,
// within the joints' limits, moving only the joints it should.
import { describe, it, expect } from "vitest";
import { Vector3 } from "../../public/js/vendor/three.js";
import { newPose, setJoint } from "../../public/js/pose-format.js";
import { JOINTS } from "../../public/js/figure-rig.js";
import { makeSkeleton, posed, onBone, withHips, withHipsOn } from "../../public/js/pose-skeleton.js";
import { DRAG_CHAINS, canDrag, dragTo, dragJoints, onPlane, dampedSolve } from "../../public/js/pose-ik.js";
import { canReach } from "../../public/js/joint-limits.js";

/** @typedef {import("../../public/js/pose-format.js").Pose} Pose */

/** Where a point on a bone is, in a pose. @param {Pose} pose @param {string} bone @param {[number, number, number]} [cm] */
function at(pose, bone, cm = [0, 0, 0]) {
  const skeleton = makeSkeleton();
  posed(skeleton, pose);
  return onBone(skeleton, bone, cm);
}

/** Every joint's angles within its limits, as whole degrees. @param {Pose} pose */
function withinLimits(pose) {
  for (const joint of JOINTS) {
    joint.moves.forEach((m, i) => {
      const a = pose.joints[joint.name][i];
      expect(Number.isInteger(a), joint.name).toBe(true);
      expect(a, `${joint.name} ${m.label}`).toBeGreaterThanOrEqual(m.min);
      expect(a, `${joint.name} ${m.label}`).toBeLessThanOrEqual(m.max);
    });
  }
}

describe("which parts drag", () => {
  it("is the arms and legs, not the trunk or head", () => {
    for (const s of ["l", "r"]) {
      for (const part of ["shoulder", "elbow", "wrist", "hip", "knee", "ankle", "toes"]) expect(canDrag(`${s}_${part}`)).toBe(true);
    }
    for (const part of ["pelvis", "hips", "spine", "chest", "head"]) expect(canDrag(part)).toBe(false);
    expect(() => dragTo(newPose(), "head", [0, 0, 0], new Vector3())).toThrow();
  });

  it("turns the upper arm or thigh at its top alone, and bends the elbow or knee for the rest", () => {
    expect(DRAG_CHAINS.l_shoulder.map(([n]) => n)).toEqual(["l_shoulder", "l_shoulder"]);
    expect(DRAG_CHAINS.l_wrist.map(([n]) => n)).toContain("l_elbow");
    expect(DRAG_CHAINS.r_ankle.map(([n]) => n)).toContain("r_knee");
    expect(DRAG_CHAINS.r_hip.map(([n]) => n)).not.toContain("r_knee");
  });
});

describe("dragging", () => {
  it("puts a hand where it's dragged, bending the elbow", () => {
    const start = newPose();
    // In front of the shoulder, within reach (going round the body to
    // the middle of the chest is more than one drag: pose-contact.js).
    const target = new Vector3(18, 130, 30);
    const moved = dragTo(start, "l_wrist", [0, -8.5, 0], target);
    expect(at(moved, "l_wrist", [0, -8.5, 0]).distanceTo(target)).toBeLessThan(1.5);
    expect(moved.joints.l_elbow[0]).toBeGreaterThan(0);
    withinLimits(moved);
  });

  it("moves only the limb held while it can reach: the other limbs, the trunk and the twists stay", () => {
    const start = setJoint(newPose(), "l_shoulder", 2, 30);
    // Somewhere this arm can reach: where its hand is with the shoulder forward and the elbow bent.
    const reachable = at(setJoint(setJoint(start, "l_shoulder", 0, 40), "l_elbow", 0, 30), "l_wrist", [0, -8.5, 0]);
    const moved = dragTo(start, "l_wrist", [0, -8.5, 0], reachable);
    for (const joint of JOINTS) {
      if (joint.name === "l_shoulder") continue;
      if (joint.name === "l_elbow") continue;
      expect(moved.joints[joint.name], joint.name).toEqual(start.joints[joint.name]);
    }
    expect(moved.joints.l_shoulder[2]).toBe(30);
    expect([moved.body, moved.lift, moved.shift]).toEqual([start.body, start.lift, start.shift]);
  });

  it("swings the arm at the shoulder when the elbow is held", () => {
    const start = newPose();
    const shoulder = at(start, "l_shoulder");
    // Straight out to the side, an upper arm's length away.
    const target = new Vector3(shoulder.x + 29, shoulder.y, shoulder.z);
    const moved = dragTo(start, "l_shoulder", [0, -29, 0], target);
    expect(at(moved, "l_elbow").distanceTo(target)).toBeLessThan(1.5);
    expect(moved.joints.l_shoulder[1]).toBeGreaterThan(80);
    expect(moved.joints.l_elbow).toEqual([0, 0]);
  });

  it("lifts a foot by bending the hip and knee", () => {
    const start = newPose();
    const foot = at(start, "r_ankle");
    const target = new Vector3(foot.x, foot.y + 40, foot.z + 20);
    const moved = dragTo(start, "r_ankle", [0, 0, 0], target);
    expect(at(moved, "r_ankle").distanceTo(target)).toBeLessThan(1.5);
    expect(moved.joints.r_hip[0]).toBeGreaterThan(0);
    expect(moved.joints.r_knee[0]).toBeGreaterThan(0);
    withinLimits(moved);
  });

  it("reaches as near as it can for a point out of reach, never past a limit", () => {
    const start = newPose();
    const far = new Vector3(200, 130, 0);
    const moved = dragTo(start, "l_wrist", [0, -8.5, 0], far);
    withinLimits(moved);
    // The arm points straight at it: the hand ends up as far out as an arm goes.
    const shoulder = at(moved, "l_shoulder");
    const hand = at(moved, "l_wrist", [0, -8.5, 0]);
    expect(hand.distanceTo(shoulder)).toBeGreaterThan(60);
    expect(hand.x).toBeGreaterThan(shoulder.x + 55);
    // Behind the back, where an elbow can't bend: still within limits.
    withinLimits(dragTo(start, "l_wrist", [0, -8.5, 0], new Vector3(0, 60, -80)));
  });

  it("follows a drag smoothly, step by step, without jumping", () => {
    let pose = newPose();
    const hand = at(pose, "l_wrist", [0, -8.5, 0]);
    let last = hand;
    for (let i = 1; i <= 10; i++) {
      const target = new Vector3(hand.x + i * 2, hand.y + i * 5, hand.z + i * 3);
      pose = dragTo(pose, "l_wrist", [0, -8.5, 0], target);
      const now = at(pose, "l_wrist", [0, -8.5, 0]);
      expect(now.distanceTo(target)).toBeLessThan(1.5);
      expect(now.distanceTo(last)).toBeLessThan(10);
      last = now;
    }
  });
});

describe("the trunk joining in", () => {
  // A leg raised as far forward as the hip goes, the knee straight.
  const raised = setJoint(newPose(), "l_hip", 0, 140);
  const hip = at(raised, "l_hip"), foot = at(raised, "l_ankle");
  const length = Math.hypot(foot.y - hip.y, foot.z - hip.z);
  /** The foot's place with the leg at `deg` from straight down, nearly its full length. @param {number} deg */
  const legAt = (deg) => new Vector3(foot.x, hip.y - 0.95 * length * Math.cos(deg * Math.PI / 180), hip.z + 0.95 * length * Math.sin(deg * Math.PI / 180));

  it("tips the pelvis back a little to lift a leg higher than the hip alone goes, keeping the other foot on the floor", () => {
    const target = legAt(160);
    let alone = raised;
    for (let k = 0; k < 6; k++) alone = dragTo({ ...alone, joints: { ...alone.joints, hips: [0, 0, 0] } }, "l_ankle", [0, 0, 0], target);
    let moved = raised;
    for (let k = 0; k < 6; k++) moved = dragTo(moved, "l_ankle", [0, 0, 0], target, { from: raised });
    expect(at(moved, "l_ankle").distanceTo(target)).toBeLessThan(at(alone, "l_ankle").distanceTo(target) - 3);
    expect(moved.joints.hips[0]).toBeLessThan(-10);
    expect(moved.joints.hips[0]).toBeGreaterThanOrEqual(-15);
    withinLimits(moved);
    // The other leg points where it did, its foot still on the floor.
    const other = at(moved, "r_ankle"), was = at(raised, "r_ankle");
    expect(Math.abs(other.y - was.y)).toBeLessThan(1.5);
    expect(Math.hypot(other.x - was.x, other.z - was.z)).toBeLessThan(4);
  });

  it("moves the pelvis only a little however far a leg is pulled, never hiking it or twisting the other leg past its limits", () => {
    const start = newPose();
    const foot0 = at(start, "l_ankle");
    // Far up, out to the side and behind: much further than a leg goes.
    const target = new Vector3(foot0.x + 120, foot0.y + 150, foot0.z - 80);
    let moved = start;
    for (let k = 0; k < 12; k++) moved = dragTo(moved, "l_ankle", [0, 0, 0], target, { from: start });
    const [tilt, hike, turn] = moved.joints.hips;
    expect(Math.abs(tilt)).toBeLessThanOrEqual(15);
    expect(hike).toBe(0);
    expect(Math.abs(turn)).toBeLessThanOrEqual(10);
    expect(canReach("r_hip", moved.joints.r_hip, moved.joints)).toBe(true);
    withinLimits(moved);
    expect(Math.abs(at(moved, "r_ankle").y - at(start, "r_ankle").y)).toBeLessThan(1.5);
  });

  it("leaves the pelvis alone when the leg is only a little short of the finger", () => {
    // 5 cm past the leg's reach straight forward: closer than TRUNK_AFTER (pose-ik.js).
    const start = setJoint(newPose(), "l_hip", 0, 90);
    const toe = at(start, "l_ankle");
    const target = new Vector3(toe.x, toe.y, toe.z + 5);
    const moved = dragTo(start, "l_ankle", [0, 0, 0], target, { from: start });
    expect(moved.joints.hips).toEqual([0, 0, 0]);
  });

  it("leaves the trunk alone while the limb can reach", () => {
    const start = newPose();
    const foot0 = at(start, "r_ankle");
    const moved = dragTo(start, "r_ankle", [0, 0, 0], new Vector3(foot0.x, foot0.y + 40, foot0.z + 20));
    expect([moved.joints.hips, moved.joints.spine, moved.joints.chest]).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  });

  it("names every joint a drag can change: the limb's, the trunk's, and the other hip for a leg", () => {
    expect(dragJoints("l_ankle")).toEqual(["l_hip", "l_knee", "hips", "r_hip"]);
    expect(dragJoints("r_wrist")).toEqual(["r_shoulder", "r_elbow", "chest"]);
  });

  it("leans the chest to reach further than an arm goes", () => {
    const start = newPose();
    const shoulder = at(start, "l_shoulder");
    // Straight up, further than the arm's length.
    const target = new Vector3(shoulder.x + 5, shoulder.y + 75, shoulder.z);
    let moved = start;
    for (let k = 0; k < 6; k++) moved = dragTo(moved, "l_wrist", [0, -8.5, 0], target);
    const reach = at(moved, "l_wrist", [0, -8.5, 0]).distanceTo(target);
    let alone = start;
    for (let k = 0; k < 6; k++) alone = dragTo({ ...alone, joints: { ...alone.joints, chest: [0, 0, 0] } }, "l_wrist", [0, -8.5, 0], target);
    expect(moved.joints.chest.some((a) => a !== 0)).toBe(true);
    expect(reach).toBeLessThan(at(alone, "l_wrist", [0, -8.5, 0]).distanceTo(target) + 0.01);
    withinLimits(moved);
  });
});

describe("the Hips sliders", () => {
  it("tip the pelvis about the hip joints, the trunk going with it and both feet staying put", () => {
    const start = newPose();
    for (const tilt of [25, -30]) {
      const moved = withHips(start, [tilt, 0, 0]);
      for (const foot of ["l_ankle", "r_ankle"]) expect(at(moved, foot).distanceTo(at(start, foot))).toBeLessThan(0.5);
      expect(Math.abs(at(moved, "head").z - at(start, "head").z)).toBeGreaterThan(15);
      expect(moved.joints.l_hip[0]).toBe(tilt);
    }
  });

  it("hike one side, lifting that leg rather than pushing the other foot into the floor", () => {
    const start = newPose();
    const moved = withHipsOn(makeSkeleton(), start, [0, 15, 0]);
    expect(moved.joints.hips).toEqual([0, 15, 0]);
    expect(at(moved, "l_ankle").y).toBeGreaterThan(at(start, "l_ankle").y + 3);
    expect(Math.abs(at(moved, "r_toes").y - at(start, "r_toes").y)).toBeLessThan(1);
  });
});

describe("onPlane", () => {
  it("is where a ray meets the flat surface facing it", () => {
    const ray = { origin: new Vector3(0, 100, 300), direction: new Vector3(0, 0, -1) };
    const hit = /** @type {Vector3} */ (onPlane(ray, new Vector3(5, 0, 20), new Vector3(0, 0, 1)));
    expect([hit.x, hit.y, hit.z]).toEqual([0, 100, 20]);
    expect(onPlane(ray, new Vector3(), new Vector3(1, 0, 0))).toBeNull();
  });
});

describe("dampedSolve", () => {
  it("gives the change that moves the point by the error, when it can", () => {
    // Each angle moves the point 1 cm along one axis per degree.
    const change = dampedSolve([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [10, -5, 2]);
    expect(change[0]).toBeCloseTo(10 / 1.09, 3);
    expect(change[1]).toBeCloseTo(-5 / 1.09, 3);
  });
});
