// Ropes that move the body: a cinch pulling uplines together (with "Move
// the body" ticked), and a see-saw rope over the ring or bamboo. Pure
// apart from three.js's math, so it's tested like dragging a limb.
//
// Both keep an upline's length as it was: a cinch bends an upline, which
// would make it longer, so the body is moved up to it instead; a see-saw
// rope is one length over the hardpoint, so one end coming closer takes
// the other further away. The joints that move are the ones between the
// body and the rope's end: an arm's or a leg's (as dragging it would), the
// waist and chest for the trunk, and the whole body's tilt and height for
// the hips. It's not a physics simulation (nothing weighs anything): the
// solver finds a fold that keeps the lengths, nudging the angles as
// dragging a limb does (pose-ik.js), within their limits, getting as near
// as it can when it can't.

import { jointNamed, clampJoint, LIFT_RANGE } from "./figure-rig.js";
import { DRAG_CHAINS, dampedSolve, snapshot, keepReachable } from "./pose-ik.js";
import { makeSkeleton, posed } from "./pose-skeleton.js";
import { ROPE, RING, BAMBOO, HASHIRA, hangs, canSeesaw, setCinchLength } from "./pose-format.js";
import { bends, segmentLength } from "./pose-cinch.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./pose-format.js").RopePoint} RopePoint */
/** @typedef {import("./pose-skeleton.js").Skeleton} Skeleton */
/**
 * One number the solver can change: a joint's angle, the body's pitch (0)
 * or roll (2), or the lift.
 * @typedef {{ joint: string, i: number } | { body: number } | { lift: true }} Angle
 */

/** How many rounds of nudging, and how close is close enough (cm). */
const ROUNDS = 40;
const CLOSE = 0.3;
/** The most a length is corrected by in one round (cm). */
const STEP = 4;
/** The small change tried in each angle (degrees, or cm for the lift). */
const PROBE = 0.5;

/** @type {(name: string, i: number) => Angle} */
const joint = (name, i) => ({ joint: name, i });
const SPINE = [joint("spine", 0), joint("spine", 1)];
const CHEST = [...SPINE, joint("chest", 0), joint("chest", 1)];
/** The trunk's parts, and the whole body's for the hips. @type {Readonly<Record<string, readonly Angle[]>>} */
const TRUNK = Object.freeze({
  spine: SPINE, chest: CHEST, head: [...CHEST, joint("head", 0), joint("head", 1)],
  pelvis: [{ body: 0 }, { body: 2 }, { lift: true }],
});

/**
 * The angles that move a point on this part of the body.
 * @param {string} bone
 * @returns {readonly Angle[]}
 */
export function chainFor(bone) {
  const limb = DRAG_CHAINS[bone];
  if (limb) return limb.map(([name, i]) => joint(name, i));
  return TRUNK[bone] ?? [];
}

/** One skeleton, reused (made when first needed). @type {Skeleton | null} */
let spare = null;

/**
 * The pose with the angles nudged until every number `errors` gives is
 * as near 0 as they can make it (at most 3 numbers).
 * @param {Pose} pose
 * @param {readonly Angle[]} angles
 * @param {(skeleton: Skeleton, trial: Pose) => number[]} errors
 * @returns {Pose}
 */
function settle(pose, angles, errors) {
  /** @type {Pose} */
  const trial = { ...pose, joints: Object.fromEntries(Object.entries(pose.joints).map(([n, a]) => [n, [...a]])), body: [...pose.body] };
  const limits = angles.map((a) => {
    if ("joint" in a) {
      const move = /** @type {import("./figure-rig.js").Joint} */ (jointNamed(a.joint)).moves[a.i];
      return [move.min, move.max];
    }
    return "body" in a ? [-180, 180] : [LIFT_RANGE[0], LIFT_RANGE[1]];
  });
  const get = (/** @type {number} */ k) => {
    const a = angles[k];
    return "joint" in a ? trial.joints[a.joint][a.i] : "body" in a ? trial.body[a.body] : trial.lift;
  };
  const set = (/** @type {number} */ k, /** @type {number} */ value) => {
    const a = angles[k];
    const v = Math.min(limits[k][1], Math.max(limits[k][0], value));
    if ("joint" in a) trial.joints[a.joint][a.i] = v;
    else if ("body" in a) trial.body[a.body] = v;
    else trial.lift = v;
  };
  /** The joints these angles move. @type {[string, number][]} */
  const moved = angles.flatMap((a) => ("joint" in a ? [/** @type {[string, number]} */ ([a.joint, a.i])] : []));
  const skeleton = spare ??= makeSkeleton();
  const measure = () => {
    posed(skeleton, trial);
    return [...errors(skeleton, trial), 0, 0, 0].slice(0, 3);
  };

  for (let round = 0; round < ROUNDS; round++) {
    const now = measure();
    const size = Math.hypot(...now);
    if (size < CLOSE) break;
    const wanted = now.map((e) => -e * Math.min(1, STEP / size));
    const columns = angles.map((_, k) => {
      const was = get(k);
      const step = was + PROBE > limits[k][1] ? -PROBE : PROBE;
      set(k, was + step);
      const moved = measure();
      set(k, was);
      return moved.map((m, r) => (m - now[r]) / step);
    });
    const before = snapshot(trial.joints, moved);
    dampedSolve(columns, wanted).forEach((d, k) => set(k, get(k) + d));
    keepReachable(trial.joints, before);
  }

  // Whole degrees and cm, as poses keep them.
  const joints = { ...pose.joints };
  for (const a of angles) if ("joint" in a) joints[a.joint] = clampJoint(a.joint, trial.joints[a.joint], pose.joints[a.joint]);
  return {
    ...pose, joints,
    body: /** @type {[number, number, number]} */ (trial.body.map((n) => Math.round(n))), lift: Math.round(trial.lift),
  };
}

/** Whether a point is on a hardpoint. @param {RopePoint} p */
const onHardpoint = (p) => p[0] === RING || p[0] === BAMBOO || p[0] === HASHIRA;

/**
 * The part of the body a hanging stretch starts from, if it's on the body.
 * @param {Pose} pose @param {number} rope @param {number} segment
 * @returns {string | null}
 */
function bodyEnd(pose, rope, segment) {
  const { p } = pose.ropes[rope];
  const end = onHardpoint(p[segment]) ? p[segment + 1] : p[segment];
  return end[0] === ROPE || onHardpoint(end) ? null : end[0];
}

/**
 * The angles for these parts of the body, each once.
 * @param {(string | null)[]} parts
 * @returns {Angle[]}
 */
function anglesFor(parts) {
  /** @type {Map<string, Angle>} */
  const all = new Map();
  for (const part of parts) for (const a of part ? chainFor(part) : []) all.set(JSON.stringify(a), a);
  return [...all.values()];
}

/**
 * A cinch made this long, with the body moved so the uplines it pulls stay
 * as long as they were.
 * @param {Pose} pose
 * @param {number} index the cinch's
 * @param {number} length cm
 * @returns {Pose}
 */
export function cinchBody(pose, index, length) {
  const next = setCinchLength(pose, index, length);
  const stretches = pose.ropes[index].p.flatMap((p) => (p[0] === ROPE && hangs(pose.ropes[p[1]], p[2]) ? [{ rope: p[1], segment: p[2] }] : []));
  const angles = anglesFor(stretches.map((s) => bodyEnd(pose, s.rope, s.segment)));
  if (!angles.length) return next;
  const skeleton = spare ??= makeSkeleton();
  posed(skeleton, pose);
  const bent = bends(skeleton, pose);
  const lengths = stretches.map((s) => segmentLength(skeleton, pose, s.rope, s.segment, bent));
  return settle(next, angles, (sk, trial) => {
    const now = bends(sk, trial);
    return stretches.map((s, k) => segmentLength(sk, trial, s.rope, s.segment, now) - lengths[k]);
  });
}

/**
 * The pose after a change to some joints, with each see-saw rope kept as
 * long as it was: where one end moved, the other end's joints (not the
 * ones changed) turn to take it up or let it out. A see-saw is left as it
 * is when nothing else can move: its other end on the hips, or on the
 * joints that were changed.
 * @param {Pose} before the pose before the change
 * @param {Pose} after the pose changed
 * @param {readonly string[]} changed the joints the change was to
 * @returns {Pose}
 */
export function keepSeesaws(before, after, changed) {
  let pose = after;
  const skeleton = spare ??= makeSkeleton();
  for (const [index, rope] of after.ropes.entries()) {
    if (!rope.s || !canSeesaw(rope) || before.ropes[index]?.p.length !== rope.p.length) continue;
    const top = rope.p.findIndex((p) => p[0] === RING || p[0] === BAMBOO);
    const sides = [top - 1, top];
    /** @param {Pose} p */
    const lengths = (p) => {
      posed(skeleton, p);
      const bent = bends(skeleton, p);
      return sides.map((s) => segmentLength(skeleton, p, index, s, bent));
    };
    const was = lengths(before);
    const now = lengths(pose);
    const total = was[0] + was[1];
    if (Math.abs(now[0] + now[1] - total) < CLOSE) continue;
    // The side that changed least is the one to move.
    const other = Math.abs(now[0] - was[0]) >= Math.abs(now[1] - was[1]) ? 1 : 0;
    const part = bodyEnd(after, index, sides[other]);
    const angles = (part ? chainFor(part) : []).filter((a) => "joint" in a && !changed.includes(a.joint));
    if (!angles.length) continue;
    pose = settle(pose, angles, (sk, trial) => {
      const bent = bends(sk, trial);
      return [sides.reduce((sum, s) => sum + segmentLength(sk, trial, index, s, bent), 0) - total];
    });
  }
  return pose;
}
