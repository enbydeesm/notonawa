// Raising and lowering uplines (pose-uplines.js): the body going with a
// line made shorter or longer, the other lines holding on.
import { describe, it, expect } from "vitest";
import * as page from "../../public/js/pose-format.js";
import { JOINTS } from "../../public/js/figure-rig.js";
import { makeSkeleton, posed } from "../../public/js/pose-skeleton.js";
import { segmentLength } from "../../public/js/pose-cinch.js";
import { dampedSolve, dampedSolveMany } from "../../public/js/pose-ik.js";
import { uplineStretch, uplineLength, setUplineLength, lowestSkin, seesawSides, seesawLengths, setSeesawStart, SEESAW_END } from "../../public/js/pose-uplines.js";
import { bodyEnd } from "../../public/js/pose-constraints.js";
import { Vector3 } from "../../public/js/vendor/three.js";

/** @typedef {import("../../public/js/pose-format.js").Pose} Pose */
/** @typedef {import("../../public/js/pose-format.js").Rope} Rope */
/** @typedef {import("../../public/js/pose-format.js").RopePoint} RopePoint */

/** @param {RopePoint[]} p @param {Partial<Rope>} [more] @returns {Rope} */
const rope = (p, more = {}) => ({ c: "red", w: 2, p, ...more });
/** @type {RopePoint} */
const RING = ["ring", 0, 0, 0];
const skeleton = makeSkeleton();
/** A stretch's taut length. @param {Pose} pose @param {number} index @param {number} [segment] */
const taut = (pose, index, segment = 0) => {
  posed(skeleton, pose);
  return segmentLength(skeleton, pose, index, segment);
};
/** @param {Pose} pose */
const low = (pose) => {
  posed(skeleton, pose);
  return lowestSkin(skeleton);
};
/** Within 1.5 cm: the solver stops close, and poses keep whole degrees. @param {number} a @param {number} b */
const near = (a, b) => expect(Math.abs(a - b)).toBeLessThan(1.5);
/** A line held while another changed: within 2.5 cm, as whole degrees share out over several lines. @param {number} a @param {number} b */
const held = (a, b) => expect(Math.abs(a - b)).toBeLessThan(2.5);
/** @param {Pose} pose */
function withinLimits(pose) {
  for (const j of JOINTS) j.moves.forEach((m, i) => {
    expect(pose.joints[j.name][i]).toBeGreaterThanOrEqual(m.min);
    expect(pose.joints[j.name][i]).toBeLessThanOrEqual(m.max);
  });
}

/** Standing under a ring. @returns {Pose} */
const standing = () => ({ ...page.newPose(), ring: [0, 250, 0] });
/** Face down under a ring, on lines from the chest, the hips and the left thigh. @returns {Pose} */
const faceDown = () => ({
  ...page.newPose(), body: [90, 0, 0], lift: 110, ring: [0, 195, 0],
  ropes: [rope([["chest", 0, 0, 0], RING]), rope([["pelvis", 0, 0, -100], RING]), rope([["l_hip", 0, -200, 0], RING])],
});

describe("an upline's Length", () => {
  it("is for a hanging stretch tied to the body: the one tapped, or the rope's first; not a see-saw's or a cinch's", () => {
    const pose = { ...standing(), ropes: [
      rope([["chest", 0, 0, 0], ["chest", 50, 0, 0], RING]),
      rope([["l_wrist", 0, 0, 0], RING, ["r_wrist", 0, 0, 0]]),
      rope([["l_wrist", 0, 0, 0], RING, ["r_wrist", 0, 0, 0]], { s: true }),
      rope([["chest", 0, 0, 0], ["spine", 0, 0, 0]]),
    ] };
    expect(uplineStretch(pose, 0)).toBe(1);
    expect(uplineStretch(pose, 0, 0)).toBe(1);
    expect(uplineStretch(pose, 1, 1)).toBe(1);
    expect(uplineStretch(pose, 1)).toBe(0);
    expect(uplineStretch(pose, 2)).toBe(-1);
    expect(uplineStretch(pose, 3)).toBe(-1);
    const sagging = page.setSlack(pose, 0, 12);
    posed(skeleton, sagging);
    expect(uplineLength(skeleton, sagging, 0, 1)).toBeCloseTo(taut(pose, 0, 1) + 12, 5);
  });

  it("shorter, on the trunk, raises the whole body, its joints as they were", () => {
    const pose = { ...standing(), ropes: [rope([["chest", 0, 0, 0], RING])] };
    const raised = setUplineLength(pose, 0, 0, taut(pose, 0) - 30);
    near(taut(raised, 0), taut(pose, 0) - 30);
    expect(raised.lift).toBeGreaterThan(pose.lift + 25);
    expect(raised.joints).toEqual(pose.joints);
    expect(raised.ropes[0].k).toBeUndefined();
  });

  it("longer, lowers a body in the air to the floor and no further, the rest slack; on the floor, it's all slack", () => {
    const pose = { ...standing(), ropes: [rope([["chest", 0, 0, 0], RING])] };
    const up = setUplineLength(pose, 0, 0, taut(pose, 0) - 40);
    // Part of the way down: still hanging, no slack.
    const part = setUplineLength(up, 0, 0, taut(up, 0) + 25);
    near(taut(part, 0), taut(up, 0) + 25);
    expect(part.ropes[0].k).toBeUndefined();
    expect(low(part)).toBeGreaterThan(10);
    // Further than the floor: standing on it, 30 cm of slack.
    const down = setUplineLength(up, 0, 0, taut(up, 0) + 70);
    expect(Math.abs(low(down))).toBeLessThan(1.5);
    near(taut(down, 0) + (down.ropes[0].k ?? 0), taut(up, 0) + 70);
    expect(down.ropes[0].k).toBeGreaterThan(25);
    // Standing already: nothing moves.
    const slack = setUplineLength(pose, 0, 0, taut(pose, 0) + 20);
    expect([slack.lift, slack.body, slack.joints]).toEqual([pose.lift, pose.body, pose.joints]);
    expect(slack.ropes[0].k).toBe(20);
    // Taking the slack back up moves nothing either.
    const back = setUplineLength(slack, 0, 0, taut(pose, 0) + 5);
    expect(back.lift).toBe(pose.lift);
    expect(back.ropes[0].k).toBe(5);
  });

  it("on a limb, turns the limb: an arm hanging down reaches up rather than back into its limit, and comes down again", () => {
    const pose = { ...standing(), ropes: [rope([["l_wrist", 0, -60, 0], RING])] };
    const raised = setUplineLength(pose, 0, 0, taut(pose, 0) - 40);
    near(taut(raised, 0), taut(pose, 0) - 40);
    expect([raised.lift, raised.body]).toEqual([pose.lift, pose.body]);
    expect(raised.joints.l_shoulder).not.toEqual(pose.joints.l_shoulder);
    withinLimits(raised);
    const lowered = setUplineLength(raised, 0, 0, taut(raised, 0) + 30);
    near(taut(lowered, 0), taut(raised, 0) + 30);
    expect(lowered.lift).toBe(pose.lift);
  });

  it("past a limb's reach, carries the body up by it", () => {
    const pose = { ...standing(), ropes: [rope([["l_wrist", 0, -60, 0], RING])] };
    const hung = setUplineLength(pose, 0, 0, taut(pose, 0) - 150);
    near(taut(hung, 0), taut(pose, 0) - 150);
    expect(hung.lift).toBeGreaterThan(pose.lift + 10);
    expect(low(hung)).toBeGreaterThan(5);
    withinLimits(hung);
  });

  it("keeps the other taut uplines as long as they were: raising the chest tips the body up about its hips", () => {
    const pose = faceDown();
    const before = [taut(pose, 1), taut(pose, 2)];
    const raised = setUplineLength(pose, 0, 0, taut(pose, 0) - 25);
    near(taut(raised, 0), taut(pose, 0) - 25);
    held(taut(raised, 1), before[0]);
    held(taut(raised, 2), before[1]);
    // Head up: the body's tip is less than face down.
    expect(raised.body[0]).toBeLessThan(80);
    withinLimits(raised);
    // And lowering it tips the head down, the hips still held.
    const lowered = setUplineLength(pose, 0, 0, taut(pose, 0) + 25);
    near(taut(lowered, 0), taut(pose, 0) + 25);
    held(taut(lowered, 1), before[0]);
    expect(lowered.body[0]).toBeGreaterThan(100);
  });

  it("lets a limb down on its own line while the trunk's lines carry the body", () => {
    const pose = faceDown();
    const lowered = setUplineLength(pose, 2, 0, taut(pose, 2) + 15);
    near(taut(lowered, 2) + (lowered.ropes[2].k ?? 0), taut(pose, 2) + 15);
    expect([lowered.lift, lowered.body]).toEqual([pose.lift, pose.body]);
    expect(lowered.joints.l_hip[0]).toBeGreaterThan(10);
    near(taut(lowered, 0), taut(pose, 0));
  });

  it("takes up another line's slack before that line holds", () => {
    const pose = page.setSlack(faceDown(), 1, 10);
    const raised = setUplineLength(pose, 0, 0, taut(pose, 0) - 25);
    // The hips' line, slack, didn't hold the hips: its whole length is as it was, where it can be.
    const whole = taut(raised, 1) + (raised.ropes[1].k ?? 0);
    expect(whole).toBeGreaterThan(taut(pose, 1) - 1.5);
    expect(raised.ropes[1].k ?? 0).toBeLessThanOrEqual(10 + Math.max(0, taut(pose, 1) - taut(raised, 1)) + 1);
  });
});

describe("an upline tied to a spot on a rope", () => {
  // A rope round the chest, and an upline added to it (Add rope).
  const chestRope = () => rope([["chest", -100, 0, 0], ["chest", 100, 0, 0]]);
  const added = () => rope([page.ropeSpot(0, 0, 0.5), RING]);

  it("is tied to the part that rope is tied to there, through ropes on ropes; a rope only between hardpoints reaches no part", () => {
    const pose = { ...standing(), ropes: [chestRope(), added(), rope([page.ropeSpot(1, 0, 0.3), RING])] };
    expect(bodyEnd(pose, 1, 0)).toBe("chest");
    expect(bodyEnd(pose, 2, 0)).toBe("chest");
    expect(uplineStretch(pose, 1)).toBe(0);
    const hardpointsOnly = { ...standing(), bamboo: [0, 200, 0, 0, 100, 10], ropes: [rope([RING, ["bamboo", 0, 0, 0]]), added()] };
    expect(bodyEnd(hardpointsOnly, 1, 0)).toBeNull();
    expect(uplineStretch(hardpointsOnly, 1)).toBe(-1);
    // A rope on itself (a loop) reaches no part, and doesn't hang.
    expect(bodyEnd({ ...standing(), ropes: [rope([page.ropeSpot(0, 0, 0.5), RING])] }, 0, 0)).toBeNull();
  });

  it("has a Length: shorter raises the body by it", () => {
    const pose = { ...standing(), ropes: [chestRope(), added()] };
    const raised = setUplineLength(pose, 1, 0, taut(pose, 1) - 30);
    near(taut(raised, 1), taut(pose, 1) - 30);
    expect(raised.lift).toBeGreaterThan(pose.lift + 25);
  });
});

describe("a see-saw's Start ◀ ▶ End", () => {
  // Arms out in front, a see-saw over the ring from wrist to wrist.
  /** @returns {Pose} */
  const seesaw = () => ({
    ...standing(), ring: [0, 200, 60],
    joints: { ...standing().joints, l_shoulder: [90, 0, 0], r_shoulder: [90, 0, 0] },
    ropes: [rope([["l_wrist", 0, 0, 0], RING, ["r_wrist", 0, 0, 0]], { s: true })],
  });
  const sides = (/** @type {Pose} */ pose) => {
    posed(skeleton, pose);
    return /** @type {{ start: number, total: number }} */ (seesawLengths(skeleton, pose, 0));
  };

  it("is only a see-saw's, both its sides on the body", () => {
    expect(seesawSides(seesaw(), 0)).toEqual({ sides: [0, 1], parts: ["l_wrist", "r_wrist"] });
    const off = { ...seesaw(), ropes: [{ ...seesaw().ropes[0], s: undefined }] };
    expect(seesawSides(off, 0)).toBeNull();
  });

  it("shortens the start side and lengthens the end side by as much, raising one end and lowering the other", () => {
    const pose = seesaw();
    const before = sides(pose);
    const moved = setSeesawStart(pose, 0, before.start - 15);
    const after = sides(moved);
    near(after.start, before.start - 15);
    held(after.total, before.total);
    const heights = (/** @type {Pose} */ p) => {
      posed(skeleton, p);
      return ["wrist.L", "wrist.R"].map((b) => /** @type {import("../../public/js/vendor/three.js").Object3D} */ (skeleton.all.get(b)).localToWorld(new Vector3()).y);
    };
    const wristsWere = heights(pose), wrists = heights(moved);
    expect(wrists[0]).toBeGreaterThan(wristsWere[0] + 5);
    expect(wrists[1]).toBeLessThan(wristsWere[1] - 5);
    withinLimits(moved);
  });

  it("stops short of the hardpoint, its whole length kept, as near as it can get", () => {
    const pose = seesaw();
    const before = sides(pose);
    const pulled = setSeesawStart(pose, 0, 0);
    const after = sides(pulled);
    expect(after.start).toBeGreaterThan(SEESAW_END - 1.5);
    expect(after.start).toBeLessThan(before.start);
    held(after.total, before.total);
    withinLimits(pulled);
  });
});

describe("solving several lengths at once", () => {
  it("agrees with the three-number solver", () => {
    const columns = [[1, 0, 0.5], [0, 2, 0.5], [0.3, 0.1, 1], [0.2, -0.4, 0.6]];
    const error = [2, -1, 0.5];
    const a = dampedSolve(columns, error), b = dampedSolveMany(columns, error);
    a.forEach((v, k) => expect(b[k]).toBeCloseTo(v, 8));
  });

  it("brings four errors down together", () => {
    const columns = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [1, 1, 0, 0]];
    const error = [1, 2, 3, 4];
    const step = dampedSolveMany(columns, error);
    const got = error.map((_, r) => columns.reduce((sum, col, k) => sum + col[r] * step[k], 0));
    got.forEach((v, r) => expect(Math.abs(v - error[r])).toBeLessThan(0.4));
  });
});
