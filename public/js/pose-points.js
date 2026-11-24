// Where a point added beside a rope's chosen point goes (the ‹ and › by
// it): along the rope as it's drawn on the skin, 5 cm toward the next
// point that way or halfway to it, whichever is less, at the chosen
// point's layer. Pure apart from three.js's math, so it's tested like the
// rest of the ropes.

import { ropePoint, toBone } from "./pose-skeleton.js";
import { skinOf, alongSkin } from "./pose-surface.js";
import { onBody, bonePoint, withLayer, layerOf, insertPoint, MAX_ROPE_POINTS } from "./pose-format.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./pose-format.js").RopePoint} RopePoint */
/** @typedef {import("./pose-skeleton.js").Skeleton} Skeleton */
/** @typedef {import("./vendor/three.js").Vector3} Vector3 */

/** How far along from the chosen point a new one goes, at most (cm). */
export const BESIDE_CM = 5;

/**
 * A point that could be added beside one: where it goes in the rope (j,
 * for insertPoint), the point, how far along the stretch it splits it is,
 * and where it is in the room (for its mark on the view).
 * @typedef {{ j: number, point: RopePoint, fraction: number, at: Vector3 }} Beside
 */

/**
 * The point that would be added beside a rope's point on the body, toward
 * the point before it (side −1) or after it (side 1); null at that end of
 * the rope, or when the rope is full.
 * @param {Skeleton} skeleton posed for the pose
 * @param {Pose} pose @param {number} index the rope's @param {number} k the chosen point
 * @param {-1 | 1} side
 * @returns {Beside | null}
 */
export function besidePoint(skeleton, pose, index, k, side) {
  const rope = pose.ropes[index];
  if (!rope || !onBody(rope, k) || rope.p.length >= MAX_ROPE_POINTS) return null;
  const n = k + side;
  if (n < 0 || n >= rope.p.length) return null;
  const here = rope.p[k], there = rope.p[n];
  // On the skin: the layers set aside, put back on the new point.
  const flat = (/** @type {RopePoint} */ p) => /** @type {RopePoint} */ (p.slice(0, 4));
  const a = ropePoint(skeleton, flat(here), pose), b = ropePoint(skeleton, flat(there), pose);
  const between = onBody(rope, n) ? alongSkin(skinOf(skeleton), here[0], a, there[0], b) : [];
  const path = [a, ...between, b];
  let total = 0;
  for (let i = 1; i < path.length; i++) total += path[i].distanceTo(path[i - 1]);
  if (total < 0.5) return null;
  const walk = Math.min(BESIDE_CM, total / 2);
  let left = walk, at = a.clone();
  for (let i = 1; i < path.length; i++) {
    const step = path[i].distanceTo(path[i - 1]);
    if (step >= left) {
      at = path[i - 1].clone().lerp(path[i], step === 0 ? 0 : left / step);
      break;
    }
    left -= step;
  }
  const point = withLayer(bonePoint(here[0], toBone(skeleton, here[0], at)), layerOf(here));
  return {
    j: side > 0 ? k + 1 : k, point, fraction: side > 0 ? walk / total : 1 - walk / total,
    at: ropePoint(skeleton, point, pose),
  };
}

/**
 * The pose with that point added (insertPoint), or as it was when there's none.
 * @param {Skeleton} skeleton posed for the pose
 * @param {Pose} pose @param {number} index @param {number} k @param {-1 | 1} side
 * @returns {{ pose: Pose, k: number }} the pose, and the new point's index (the one to choose next)
 */
export function addBeside(skeleton, pose, index, k, side) {
  const beside = besidePoint(skeleton, pose, index, k, side);
  if (!beside) return { pose, k };
  return { pose: insertPoint(pose, index, beside.j, beside.point, beside.fraction), k: beside.j };
}
