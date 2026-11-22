// Ropes that move the body: a cinch pulling uplines together (with "Move
// the body" ticked), a cinch round the body drawing the parts it's tied
// to together, a rope of two points made shorter (its Length), and a
// see-saw rope over the ring or bamboo. Pure apart from three.js's math,
// so it's tested like dragging a limb.
//
// A cinch on uplines and a see-saw keep an upline's length as it was: a
// cinch bends an upline, which would make it longer, so the body is moved
// up to it instead; a see-saw rope is one length over the hardpoint, so
// one end coming closer takes the other further away. A cinch round the
// body, or a two-point rope shortened, brings its ends closer by moving
// the body, the ropes on it staying where they're tied. The joints that move are the ones between the
// body and the rope's end: an arm's or a leg's (as dragging it would), the
// waist and chest for the trunk, and the whole body's tilt and height for
// the hips. It's not a physics simulation (nothing weighs anything): the
// solver finds a fold that keeps the lengths, nudging the angles as
// dragging a limb does (pose-ik.js), within their limits, getting as near
// as it can when it can't.

import { jointNamed, clampJoint, LIFT_RANGE } from "./figure-rig.js";
import { DRAG_CHAINS, dampedSolve, dampedSolveMany, snapshot, keepReachable } from "./pose-ik.js";
import { makeSkeleton, posed } from "./pose-skeleton.js";
import { SHIFT_RANGE, ROPE, RING, BAMBOO, HASHIRA, hangs, canSeesaw, setCinchLength, pullsUplines, setSlack } from "./pose-format.js";
import { bends, segmentLength, cinchPoints } from "./pose-cinch.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./pose-format.js").RopePoint} RopePoint */
/** @typedef {import("./pose-format.js").Rope} Rope */
/** @typedef {import("./pose-skeleton.js").Skeleton} Skeleton */
/**
 * One number the solver can change: a joint's angle, the body's pitch (0),
 * turn (1) or roll (2), the lift, or where the figure stands (shift:
 * across, 0, or front to back, 1).
 * @typedef {{ joint: string, i: number } | { body: number } | { lift: true } | { shift: number }} Angle
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
 * as near 0 as they can make it (any number of them: three or fewer are
 * solved as a drag is, more by elimination).
 * @param {Pose} pose
 * @param {readonly Angle[]} angles
 * @param {(skeleton: Skeleton, trial: Pose) => number[]} errors
 * @param {{ exact?: boolean }} [options] exact: the body's tilt, height and
 *   place left as fractions (for a caller taking many small steps, which
 *   rounds once at the end); joints are always whole degrees
 * @returns {Pose}
 */
export function settle(pose, angles, errors, { exact = false } = {}) {
  /** @type {Pose} */
  const trial = {
    ...pose, joints: Object.fromEntries(Object.entries(pose.joints).map(([n, a]) => [n, [...a]])), body: [...pose.body],
    shift: [...(pose.shift ?? [0, 0])],
  };
  const limits = angles.map((a) => {
    if ("joint" in a) {
      const move = /** @type {import("./figure-rig.js").Joint} */ (jointNamed(a.joint)).moves[a.i];
      return [move.min, move.max];
    }
    return "body" in a ? [-180, 180] : "shift" in a ? [...SHIFT_RANGE[a.shift]] : [LIFT_RANGE[0], LIFT_RANGE[1]];
  });
  const get = (/** @type {number} */ k) => {
    const a = angles[k];
    return "joint" in a ? trial.joints[a.joint][a.i] : "body" in a ? trial.body[a.body] : "shift" in a ? trial.shift[a.shift] : trial.lift;
  };
  const set = (/** @type {number} */ k, /** @type {number} */ value) => {
    const a = angles[k];
    const v = Math.min(limits[k][1], Math.max(limits[k][0], value));
    if ("joint" in a) trial.joints[a.joint][a.i] = v;
    else if ("body" in a) trial.body[a.body] = v;
    else if ("shift" in a) trial.shift[a.shift] = v;
    else trial.lift = v;
  };
  /** The joints these angles move. @type {[string, number][]} */
  const moved = angles.flatMap((a) => ("joint" in a ? [/** @type {[string, number]} */ ([a.joint, a.i])] : []));
  const skeleton = spare ??= makeSkeleton();
  const measure = () => {
    posed(skeleton, trial);
    const all = errors(skeleton, trial);
    return all.length > 3 ? all : [...all, 0, 0, 0].slice(0, 3);
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
    (wanted.length > 3 ? dampedSolveMany(columns, wanted) : dampedSolve(columns, wanted)).forEach((d, k) => set(k, get(k) + d));
    keepReachable(trial.joints, before);
  }

  // Whole degrees and cm, as poses keep them (0, not -0).
  const whole = (/** @type {number} */ n) => (exact ? n : Math.round(n) + 0);
  const joints = { ...pose.joints };
  for (const a of angles) if ("joint" in a) joints[a.joint] = clampJoint(a.joint, trial.joints[a.joint], pose.joints[a.joint], joints);
  return {
    ...pose, joints,
    body: /** @type {[number, number, number]} */ (trial.body.map(whole)), lift: whole(trial.lift),
    // Only when the figure's place was one of the angles (older poses have none).
    ...(angles.some((a) => "shift" in a) ? { shift: /** @type {[number, number]} */ (trial.shift.map(whole)) } : {}),
  };
}

/** Whether a point is on a hardpoint. @param {RopePoint} p */
export const onHardpoint = (p) => p[0] === RING || p[0] === BAMBOO || p[0] === HASHIRA;

/**
 * The part of the body a hanging stretch starts from, if it's on the body:
 * where it's tied, or, tied to a spot on another rope (an added rope, or a
 * rope's end on a cinch), the part that rope is tied to there (its
 * segment's nearer end, else the other), followed through ropes on ropes.
 * Null when nothing there reaches the body (a rope only between
 * hardpoints).
 * @param {Pose} pose @param {number} rope @param {number} segment
 * @returns {string | null}
 */
export function bodyEnd(pose, rope, segment) {
  const { p } = pose.ropes[rope];
  return partAt(pose, onHardpoint(p[segment]) ? p[segment + 1] : p[segment], 0);
}

/** How many ropes on ropes bodyEnd follows (more is a loop). */
const ROPES_DEEP = 8;

/**
 * The part of the body a point is on, through ropes on ropes.
 * @param {Pose} pose @param {RopePoint | undefined} point @param {number} depth
 * @returns {string | null}
 */
function partAt(pose, point, depth) {
  if (!point || onHardpoint(point)) return null;
  if (point[0] !== ROPE) return /** @type {string} */ (point[0]);
  const host = depth < ROPES_DEEP ? pose.ropes[/** @type {number} */ (point[1])] : undefined;
  if (!host) return null;
  const segment = /** @type {number} */ (point[2]), near = /** @type {number} */ (point[3]) < 500 ? 0 : 1;
  for (const k of [near, 1 - near]) {
    const part = partAt(pose, host.p[segment + k], depth + 1);
    if (part) return part;
  }
  return null;
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
  if (!pullsUplines(pose.ropes, pose.ropes[index])) return drawTogether(pose, next, index, length);
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

/** The whole body's tilt and height: what brings the trunk to a hardpoint. @type {readonly Angle[]} */
export const WHOLE_BODY = TRUNK.pelvis;

/**
 * The parts of the body a cinch is tied to: those its points are on, and
 * those at the ends of the stretches of rope it's tied through.
 * @param {Pose} pose @param {Rope} cinch
 * @returns {string[]}
 */
function cinchParts(pose, cinch) {
  /** @param {RopePoint | undefined} p */
  const bone = (p) => (p && p[0] !== ROPE && !onHardpoint(p) ? [p[0]] : []);
  return [...new Set(cinch.p.flatMap((p) => {
    if (p[0] !== ROPE) return bone(p);
    const { p: points } = pose.ropes[p[1]];
    return [...bone(points[p[2]]), ...bone(points[p[2] + 1])];
  }))];
}

/**
 * A cinch round the body made this long, the parts it's tied to turned
 * closer together (only joints: the whole body's tilt and height bring
 * nothing together). What they can't close (at their limits, or with both
 * ends on one part) is left to the cinch, which then pulls the ropes in
 * (pose-cinch.js).
 * @param {Pose} pose @param {Pose} next the cinch made this long
 * @param {number} index @param {number} length
 * @returns {Pose}
 */
function drawTogether(pose, next, index, length) {
  const parts = cinchParts(pose, pose.ropes[index]);
  const angles = parts.length < 2 ? [] : anglesFor(parts).filter((a) => "joint" in a);
  if (!angles.length) return next;
  // Its span as tied, not pulled in by its own length.
  /** @param {Pose} trial */
  const loose = (trial) => ({ ...trial, ropes: trial.ropes.map((r, i) => (i === index ? { ...r, l: Number.MAX_SAFE_INTEGER } : r)) });
  return settle(next, angles, (sk, trial) => [cinchPoints(sk, loose(trial), index).span - length]);
}

/**
 * The angles that bring a two-point rope's ends closer: the limbs it's
 * tied to, or, for one between the trunk and a hardpoint or a spot on a
 * rope, the whole body's tilt and height; between two parts of the body,
 * only joints.
 * @param {Rope} rope
 * @returns {Angle[]}
 */
function lengthAngles(rope) {
  const bones = rope.p.flatMap((p) => (p[0] !== ROPE && !onHardpoint(p) ? [p[0]] : []));
  if (bones.length === 2) return bones[0] === bones[1] ? [] : anglesFor(bones).filter((a) => "joint" in a);
  const [bone] = bones;
  return bone in DRAG_CHAINS ? [...chainFor(bone)] : [...WHOLE_BODY];
}

/**
 * How long a two-point rope is now: taut, through any cinch's bends, and
 * its slack.
 * @param {Skeleton} skeleton posed for the pose
 * @param {Pose} pose @param {number} index
 */
export function ropeLength(skeleton, pose, index) {
  return segmentLength(skeleton, pose, index, 0) + (pose.ropes[index].k ?? 0);
}

/**
 * A two-point rope made this long (its Length): longer than it is taut,
 * the rest is slack; shorter, the body is moved to bring its ends that
 * close (as near as the joints allow), with no slack.
 * @param {Pose} pose @param {number} index @param {number} length cm
 * @returns {Pose}
 */
export function setRopeLength(pose, index, length) {
  const skeleton = spare ??= makeSkeleton();
  posed(skeleton, pose);
  const taut = segmentLength(skeleton, pose, index, 0);
  if (length >= taut - 0.5) return setSlack(pose, index, length - taut);
  const plain = setSlack(pose, index, 0);
  const angles = lengthAngles(pose.ropes[index]);
  if (!angles.length) return plain;
  return settle(plain, angles, (sk, trial) => [segmentLength(sk, trial, index, 0) - length]);
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
