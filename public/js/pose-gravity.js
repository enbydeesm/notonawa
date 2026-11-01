// The feet under gravity: a foot whose shin points down, moved by a change
// (the body lifted, a leg bent, the hips or the whole body turned), lands
// flat on the floor, rises onto the ball of the foot as the heel leaves it
// (the ankle pointing, the toes bent up to stay on the floor: a "Barbie
// foot"), and goes en pointe (pointed as far as it goes, the toes in line)
// once the move takes it out of reach. A foot the change didn't move is
// left as it is, so its ankle and toes sliders are mine, and so is one
// already out of reach before the change, until it comes back down. A body
// lying, kneeling or upside down has no shin pointing down, so is left
// alone. Pure apart from three.js's math.

import { Vector3 } from "./vendor/three.js";
import { jointNamed } from "./figure-rig.js";
import { posed, onBone } from "./pose-skeleton.js";
import { newPose } from "./pose-format.js";
import { standingLift } from "./figure-body.js";

/** @typedef {import("./pose-skeleton.js").Skeleton} Skeleton */
/** @typedef {import("./pose-format.js").Pose} Pose */

/** How far a foot can be off the floor and still count as on it (cm). */
const ON_FLOOR = 0.5;
/** A shin points down when it's within this of straight down (its direction's y, at most). */
const SHIN_DOWN = -0.5;
/** How far an ankle must move for the foot to count as moved (cm). */
const MOVED = 0.05;
/** Halvings in a search for an angle (a range of 110° to well under a degree). */
const STEPS = 9;

const ankleRange = () => {
  const [move] = /** @type {import("./figure-rig.js").Joint} */ (jointNamed("l_ankle")).moves;
  return [move.min, move.max];
};
const toesRange = () => {
  const [move] = /** @type {import("./figure-rig.js").Joint} */ (jointNamed("l_toes")).moves;
  return [move.min, move.max];
};

/**
 * Each body shape's foot: the heel (on the ankle) and the toes' tip (on
 * the toes) in their bones' own directions, and how high the ball of the
 * foot is standing on the floor, from the body standing.
 * @type {Map<string, { heel: Vector3, tip: Vector3, ball: number }>}
 */
const FEET = new Map();

/**
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @param {"l" | "r"} side
 */
function foot(skeleton, pose, side) {
  const key = `${pose.shape.join()}|${side}`;
  const known = FEET.get(key);
  if (known) return known;
  const standing = { ...newPose(), shape: pose.shape, lift: standingLift(pose.shape) };
  posed(skeleton, standing);
  const ankle = onBone(skeleton, `${side}_ankle`), ball = onBone(skeleton, `${side}_toes`);
  const length = ball.z - ankle.z;
  // The heel a little behind the ankle, as low as the ball; the tip ahead of the ball.
  const heel = new Vector3(ankle.x, ball.y, ankle.z - 0.4 * length);
  const tip = new Vector3(ball.x, ball.y, ball.z + 0.45 * length);
  const made = {
    heel: /** @type {import("./vendor/three.js").Object3D} */ (skeleton.bones.get(`${side}_ankle`)).worldToLocal(heel),
    tip: /** @type {import("./vendor/three.js").Object3D} */ (skeleton.bones.get(`${side}_toes`)).worldToLocal(tip),
    ball: ball.y,
  };
  FEET.set(key, made);
  return made;
}

/**
 * A pose with one foot's ankle and toes set.
 * @param {Pose} pose @param {"l" | "r"} side @param {number} ankle @param {number} toes
 * @returns {Pose}
 */
const withFoot = (pose, side, ankle, toes) => ({
  ...pose, joints: { ...pose.joints, [`${side}_ankle`]: [Math.round(ankle)], [`${side}_toes`]: [Math.round(toes)] },
});

/**
 * Where a foot is, posed: its ankle, whether its shin points down, and its
 * heel's, ball's and tip's heights.
 * @param {Skeleton} skeleton @param {Pose} pose @param {"l" | "r"} side
 */
function measure(skeleton, pose, side) {
  const shape = foot(skeleton, pose, side);
  posed(skeleton, pose);
  const knee = onBone(skeleton, `${side}_knee`), ankle = onBone(skeleton, `${side}_ankle`);
  const shin = ankle.clone().sub(knee);
  return {
    ankle,
    down: shin.length() > 1 && shin.y / shin.length() <= SHIN_DOWN,
    heel: onBone(skeleton, `${side}_ankle`, [shape.heel.x, shape.heel.y, shape.heel.z]).y,
    ball: onBone(skeleton, `${side}_toes`).y,
    tip: onBone(skeleton, `${side}_toes`, [shape.tip.x, shape.tip.y, shape.tip.z]).y,
    floor: shape.ball,
  };
}

/**
 * Where gravity puts a foot: flat, on its ball (the ankle and toes for
 * it), or null when even pointed it can't reach the floor (or its shin
 * doesn't point down: nothing to do).
 * @param {Skeleton} skeleton @param {Pose} pose @param {"l" | "r"} side
 * @returns {{ ankle: number, toes: number } | "away" | null}
 */
function footing(skeleton, pose, side) {
  const flat = measure(skeleton, withFoot(pose, side, 0, 0), side);
  if (!flat.down) return null;
  if (Math.min(flat.heel, flat.ball) <= flat.floor + ON_FLOOR) return { ankle: 0, toes: 0 };
  const [pointed] = ankleRange();
  if (measure(skeleton, withFoot(pose, side, pointed, 0), side).ball > flat.floor + ON_FLOOR) return "away";
  // The ankle pointed just enough for the ball to touch the floor.
  let low = pointed, high = 0;
  for (let i = 0; i < STEPS; i++) {
    const mid = (low + high) / 2;
    if (measure(skeleton, withFoot(pose, side, mid, 0), side).ball > flat.floor) high = mid; else low = mid;
  }
  const ankle = Math.round((low + high) / 2);
  // Then the toes bent up just enough to stay on it.
  const [, up] = toesRange();
  if (measure(skeleton, withFoot(pose, side, ankle, 0), side).tip >= flat.floor) return { ankle, toes: 0 };
  let under = 0, over = up;
  for (let i = 0; i < STEPS; i++) {
    const mid = (under + over) / 2;
    if (measure(skeleton, withFoot(pose, side, ankle, mid), side).tip < flat.floor) under = mid; else over = mid;
  }
  return { ankle, toes: Math.round((under + over) / 2) };
}

/**
 * A change with gravity on the feet it moved (see the top of this file).
 * @param {Skeleton} skeleton any (it's posed)
 * @param {Pose} before the pose before the change
 * @param {Pose} after the change
 * @returns {Pose}
 */
export function grounded(skeleton, before, after) {
  let pose = after;
  for (const side of /** @type {const} */ (["l", "r"])) {
    const was = measure(skeleton, before, side).ankle;
    if (measure(skeleton, pose, side).ankle.distanceTo(was) < MOVED) continue;
    const now = footing(skeleton, pose, side);
    if (now === null) continue;
    if (now !== "away") {
      pose = withFoot(pose, side, now.ankle, now.toes);
      continue;
    }
    // Out of reach: en pointe if this change lifted it off the floor.
    const then = footing(skeleton, before, side);
    if (then !== null && then !== "away") pose = withFoot(pose, side, ankleRange()[0], 0);
  }
  return pose;
}
