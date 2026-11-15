// Raising and lowering an upline: its hanging stretch (from the body up
// to the ring or bamboo) made shorter or longer, the body going with it.
// Pure apart from three.js's math, so it's tested like the other ropes.
//
// Shorter raises the part it's tied to: an arm or a leg turns up to it, as
// dragging it would, and once the limb can't reach, or when it's tied to
// the trunk, the whole body rises and tips. Longer lowers it again, down
// to the floor; what's left once the body is down is slack.
//
// The other uplines hold on while one changes: each taut one (no slack,
// not a see-saw) keeps its length, the limb it's tied to turning to allow
// it, and one with slack takes it up or lets it out before it holds.
//
// It's not a physics simulation: nothing weighs anything, so nothing
// swings to hang under its line. The solver finds the smallest change
// that gives every rope its length (pose-constraints.js's `settle`), and
// two rules stand in for gravity: a line let out lowers what hangs from
// it, and a limb's line carries the whole body only when the body is off
// the floor with no taut line on the trunk to carry it instead.

import { DRAG_CHAINS } from "./pose-ik.js";
import { makeSkeleton, posed } from "./pose-skeleton.js";
import { LIFT_RANGE } from "./figure-rig.js";
import { hangs, isCinch, setSlack, setJoint, clamp, SLACK_RANGE } from "./pose-format.js";
import { bends, segmentLength } from "./pose-cinch.js";
import { capsules } from "./pose-contact.js";
import { settle, chainFor, bodyEnd, WHOLE_BODY } from "./pose-constraints.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./pose-format.js").Rope} Rope */
/** @typedef {import("./pose-skeleton.js").Skeleton} Skeleton */
/** @typedef {import("./pose-constraints.js").Angle} Angle */
/** @typedef {{ rope: number, segment: number, part: string }} Stretch a hanging stretch and the part of the body it's tied to */

/** How close a length is close enough (cm): the solver's, and whole degrees. */
const CLOSE = 1.5;
/** How far the skin can be off the floor and the body still count as on it (cm). */
const ON_FLOOR = 1;

/** One skeleton, reused (made when first needed). @type {Skeleton | null} */
let spare = null;

/**
 * Which of a rope's hanging stretches its Length is for: the one tapped,
 * or its first; -1 when it has none tied to the body, or runs free over
 * the hardpoint (a see-saw keeps its own length).
 * @param {Pose} pose @param {number} index the rope's @param {number} [segment] the stretch tapped
 * @returns {number}
 */
export function uplineStretch(pose, index, segment = -1) {
  const rope = pose.ropes[index];
  if (!rope || isCinch(rope) || rope.s) return -1;
  const tied = (/** @type {number} */ s) => hangs(rope, s) && bodyEnd(pose, index, s) !== null;
  if (tied(segment)) return segment;
  return rope.p.findIndex((_, s) => tied(s));
}

/**
 * How long an upline's hanging stretch is: taut, through any cinch's
 * bends, and the rope's slack.
 * @param {Skeleton} skeleton posed for the pose
 * @param {Pose} pose @param {number} index @param {number} segment
 */
export function uplineLength(skeleton, pose, index, segment) {
  return segmentLength(skeleton, pose, index, segment) + (pose.ropes[index].k ?? 0);
}

/**
 * How high the skin's lowest point is (cm; the body as capsules).
 * @param {Skeleton} skeleton posed
 */
export function lowestSkin(skeleton) {
  let low = Infinity;
  for (const group of capsules(skeleton)) for (const { a, b, r } of group) low = Math.min(low, a.y - r, b.y - r);
  return low;
}

/**
 * Every other upline's hanging stretches tied to the body, taut or slack.
 * @param {Pose} pose @param {number} index the rope being changed
 * @returns {Stretch[]}
 */
function otherStretches(pose, index) {
  return pose.ropes.flatMap((rope, r) => (r === index || isCinch(rope) || rope.s ? [] : rope.p.flatMap((_, s) => {
    const part = hangs(rope, s) ? bodyEnd(pose, r, s) : null;
    return part ? [{ rope: r, segment: s, part }] : [];
  })));
}

/** Whether a part is the trunk's (the whole body carries it), not a limb's. @param {string} part */
const onTrunk = (part) => !(part in DRAG_CHAINS);

/** Each angle once. @param {readonly Angle[]} angles @returns {Angle[]} */
const once = (angles) => [...new Map(angles.map((a) => [JSON.stringify(a), a])).values()];

/** How far a limb is swung forward or out to start again from, when it gets stuck (degrees). */
const SEED = 30;

/**
 * A limb turned to give its line its length. The solver follows the
 * steepest way there, which from hanging straight down can be backward,
 * into the joint's limit; so when it stops short, it starts again with
 * the limb swung a little forward, then a little out, and the nearest wins.
 * @param {Pose} pose
 * @param {readonly Angle[]} chain the limb's angles
 * @param {(skeleton: Skeleton, trial: Pose) => number[]} errors
 * @param {(trial: Pose) => number} off how far from its length the line is left
 * @returns {Pose}
 */
function limbTo(pose, chain, errors, off) {
  let best = settle(pose, [...chain], errors);
  let left = off(best);
  for (const a of chain.slice(0, 2)) {
    if (left <= CLOSE) break;
    if (!("joint" in a)) continue;
    const tried = settle(setJoint(pose, a.joint, a.i, pose.joints[a.joint][a.i] + SEED), [...chain], errors);
    const short = off(tried);
    if (short < left - 1) [best, left] = [tried, short];
  }
  return best;
}

/**
 * An upline's hanging stretch made this long (its Length), the body
 * raised or lowered with it and the other uplines keeping theirs.
 * @param {Pose} pose
 * @param {number} index the rope's
 * @param {number} segment its hanging stretch (uplineStretch)
 * @param {number} length cm
 * @returns {Pose}
 */
export function setUplineLength(pose, index, segment, length) {
  const part = bodyEnd(pose, index, segment);
  if (!part || !hangs(pose.ropes[index], segment)) return pose;
  const skeleton = spare ??= makeSkeleton();
  posed(skeleton, pose);
  const bent = bends(skeleton, pose);
  const taut = segmentLength(skeleton, pose, index, segment, bent);
  const others = otherStretches(pose, index);
  const was = others.map((o) => segmentLength(skeleton, pose, o.rope, o.segment, bent));
  const held = others.filter((o) => !pose.ropes[o.rope].k);
  const heldWas = held.map((o) => was[others.indexOf(o)]);
  const floor = Math.min(0, lowestSkin(skeleton));
  const offFloor = lowestSkin(skeleton) > ON_FLOOR;

  const raising = length < taut - 0.5;
  const lowering = length > taut + 0.5;
  // Whether this line carries the body: tied to the trunk, or to a limb of
  // a body off the floor with no taut line on its trunk.
  const carries = onTrunk(part) || (offFloor && !held.some((o) => onTrunk(o.part)));
  let next = setSlack(pose, index, 0);

  if (raising || (lowering && (carries ? offFloor : true))) {
    /** @param {Skeleton} sk @param {Pose} trial */
    const errors = (sk, trial) => {
      const now = bends(sk, trial);
      return [segmentLength(sk, trial, index, segment, now) - length,
        ...held.map((o, k) => segmentLength(sk, trial, o.rope, o.segment, now) - heldWas[k])];
    };
    /** @param {Pose} trial */
    const off = (trial) => {
      posed(skeleton, trial);
      return Math.abs(segmentLength(skeleton, trial, index, segment) - length);
    };
    // The whole body's tilt and height, with the limbs the other lines are
    // tied to turning to keep their lengths.
    const whole = once([...WHOLE_BODY, ...(onTrunk(part) ? [] : chainFor(part)), ...held.flatMap((o) => (onTrunk(o.part) ? [] : chainFor(o.part)))]);
    if (onTrunk(part)) next = settle(next, whole, errors);
    else {
      // The limb alone first; the body follows when the limb can't get
      // there and the line carries it (raising: always, once out of reach).
      if (!(lowering && carries)) next = limbTo(next, chainFor(part), errors, off);
      if (off(next) > CLOSE && (raising || carries)) next = settle(next, whole, errors);
    }
    // Lowered into the floor: back up onto it.
    posed(skeleton, next);
    const sunk = floor - lowestSkin(skeleton);
    if (lowering && sunk > 0.5) next = { ...next, lift: clamp(next.lift + sunk, LIFT_RANGE) };
  }

  // What the body didn't take up is slack; the other lines' slack is taken
  // up or let out by however much their ends moved.
  posed(skeleton, next);
  const now = bends(skeleton, next);
  next = setSlack(next, index, Math.max(0, length - segmentLength(skeleton, next, index, segment, now)));
  const changed = new Map();
  others.forEach((o, k) => {
    const slack = pose.ropes[o.rope].k;
    if (!slack) return;
    const grew = segmentLength(skeleton, next, o.rope, o.segment, now) - was[k];
    changed.set(o.rope, (changed.get(o.rope) ?? slack) - grew);
  });
  for (const [rope, slack] of changed) next = setSlack(next, rope, clamp(slack, SLACK_RANGE));
  return next;
}
