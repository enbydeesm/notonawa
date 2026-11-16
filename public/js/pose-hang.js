// A body in the air hanging under its lines: the whole body, its joints
// as posed, swung, tipped and turned until its weight sits as low as its
// taut uplines allow. On one line that's plumb under the hardpoint; on
// several, the balance between them. Pure apart from three.js's math.
//
// The weight is each of the body's capsules' (pose-contact.js) volume, so
// a heavier belly or bigger thighs pull as they should. The body moves as
// one piece: its tip, turn, roll, height and where it stands. Limbs don't
// droop, and nothing swings over time: this finds where it comes to rest.
//
// Each taut upline keeps its length; one with slack is free until the
// settling draws it tight, and holds from then on. A body touching the
// floor is left alone (the floor carries it, and we don't work out how
// much), and the settling never takes one into the floor.
//
// How: the weight's middle is lowered a few centimetres at a time, the
// solver (pose-constraints.js's `settle`) finding the smallest move that
// does it with every line at its length; when it can't, the step halves,
// until no step helps.

import { Vector3 } from "./vendor/three.js";
import { LIFT_RANGE } from "./figure-rig.js";
import { makeSkeleton, posed } from "./pose-skeleton.js";
import { hangs, isCinch, setSlack, clamp, SLACK_RANGE } from "./pose-format.js";
import { bends, segmentLength } from "./pose-cinch.js";
import { capsules } from "./pose-contact.js";
import { settle, bodyEnd } from "./pose-constraints.js";
import { lowestSkin } from "./pose-uplines.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./pose-skeleton.js").Skeleton} Skeleton */
/** @typedef {import("./pose-constraints.js").Angle} Angle */

/** How far the skin can be off the floor and the body still count as on it (cm). */
const ON_FLOOR = 1;
/** The first step down, and the smallest worth taking (cm). */
const STEP = 4;
const SMALLEST = 0.25;
/** How far off its length a line can end a step (cm), and the least a step must lower the weight. */
const HELD = 0.5;
const GAINED = 0.1;
/** How much lower the weight must end for the body to have moved at all (cm). */
const AT_REST = 0.3;
/** The most steps (a body turning right over takes about thirty). */
const MOST = 80;

/** The whole body as one piece: tip, turn, roll, height, and where it stands. @type {readonly Angle[]} */
const WHOLE = Object.freeze([{ body: 0 }, { body: 1 }, { body: 2 }, { lift: true }, { shift: 0 }, { shift: 1 }]);

/** One skeleton, reused (made when first needed). @type {Skeleton | null} */
let spare = null;

/**
 * The middle of the body's weight (cm, in the room): each capsule's
 * volume at its own middle.
 * @param {Skeleton} skeleton posed
 * @returns {Vector3}
 */
export function weightMiddle(skeleton) {
  const sum = new Vector3();
  let total = 0;
  for (const group of capsules(skeleton)) {
    for (const { a, b, r } of group) {
      const volume = Math.PI * r * r * (a.distanceTo(b) + 4 * r / 3);
      sum.x += (a.x + b.x) / 2 * volume;
      sum.y += (a.y + b.y) / 2 * volume;
      sum.z += (a.z + b.z) / 2 * volume;
      total += volume;
    }
  }
  return sum.multiplyScalar(1 / total);
}

/**
 * Every upline's hanging stretch tied to the body (not a see-saw's, which
 * runs free), with how long the rope lets it be.
 * @param {Skeleton} skeleton posed for the pose
 * @param {Pose} pose
 * @returns {{ rope: number, segment: number, length: number, slack: number }[]}
 */
function lines(skeleton, pose) {
  const bent = bends(skeleton, pose);
  return pose.ropes.flatMap((rope, r) => (isCinch(rope) || rope.s ? [] : rope.p.flatMap((_, s) => {
    if (!hangs(rope, s) || bodyEnd(pose, r, s) === null) return [];
    const slack = rope.k ?? 0;
    return [{ rope: r, segment: s, length: segmentLength(skeleton, pose, r, s, bent) + slack, slack }];
  })));
}

/**
 * Whether a body would hang: off the floor, with a taut or slack upline
 * tied to it.
 * @param {Pose} pose
 * @returns {boolean}
 */
export function canHang(pose) {
  const skeleton = spare ??= makeSkeleton();
  posed(skeleton, pose);
  return lowestSkin(skeleton) > ON_FLOOR && lines(skeleton, pose).length > 0;
}

/**
 * The pose with the body hanging under its lines: moved as one piece
 * until its weight is as low as the lines allow. Unchanged when it's on
 * the floor or has no upline.
 * @param {Pose} pose
 * @returns {Pose}
 */
export function hang(pose) {
  const skeleton = spare ??= makeSkeleton();
  posed(skeleton, pose);
  if (lowestSkin(skeleton) <= ON_FLOOR) return pose;
  const all = lines(skeleton, pose);
  if (!all.length) return pose;
  // The lines holding now: the taut ones. A slack one joins once drawn tight.
  const holding = new Set(all.filter((l) => !l.slack));

  /** @param {Pose} trial @returns {{ low: number, floor: number, off: number, tight: typeof all }} low: how high the weight is, lines' give taken off */
  const measure = (trial) => {
    posed(skeleton, trial);
    const bent = bends(skeleton, trial);
    const over = all.map((l) => segmentLength(skeleton, trial, l.rope, l.segment, bent) - l.length);
    // A line let out a little lowers the weight for nothing: the height
    // counts with the most any holding line is over its length.
    return {
      low: weightMiddle(skeleton).y + Math.max(0, ...all.map((l, k) => (holding.has(l) ? over[k] : 0))), floor: lowestSkin(skeleton),
      off: Math.max(0, ...all.map((l, k) => (holding.has(l) ? Math.abs(over[k]) : over[k]))),
      tight: all.filter((l, k) => !holding.has(l) && over[k] > -SMALLEST),
    };
  };

  let best = pose;
  let { low } = measure(pose);
  const began = low;
  let step = STEP;
  for (let n = 0; n < MOST && step >= SMALLEST; n++) {
    posed(skeleton, best);
    const target = weightMiddle(skeleton).y - step;
    const held = [...holding];
    const tried = settle(best, WHOLE, (sk, trial) => {
      const bent = bends(sk, trial);
      return [weightMiddle(sk).y - target, ...held.map((l) => segmentLength(sk, trial, l.rope, l.segment, bent) - l.length)];
    }, { exact: true });
    const now = measure(tried);
    if (now.off <= HELD && now.floor >= 0 && now.low < low - GAINED) {
      best = tried;
      low = now.low;
      continue;
    }
    // A slack line drawn tight holds from here; try the same step again with it.
    if (now.tight.length && now.floor >= 0) {
      for (const l of now.tight) holding.add(l);
      continue;
    }
    step /= 2;
  }
  if (best === pose) return pose;
  // Whole degrees and centimetres, as poses keep them. Under a
  // third of a centimetre gained by then is rounding, not a move: it was at rest.
  best = {
    ...best, lift: clamp(best.lift, LIFT_RANGE), body: /** @type {[number, number, number]} */ (best.body.map((n) => Math.round(n) + 0)),
    shift: /** @type {[number, number]} */ (best.shift.map((n) => Math.round(n) + 0)),
  };
  // Rounding can leave the skin a hair under the floor: up a centimetre.
  if (measure(best).floor < 0) best = { ...best, lift: clamp(best.lift + 1, LIFT_RANGE) };
  if (began - measure(best).low < AT_REST) return pose;

  // Each line that had slack keeps its whole length: what isn't taut is slack.
  posed(skeleton, best);
  const bent = bends(skeleton, best);
  for (const l of all) {
    if (!l.slack) continue;
    best = setSlack(best, l.rope, clamp(l.length - segmentLength(skeleton, best, l.rope, l.segment, bent), SLACK_RANGE));
  }
  return best;
}
