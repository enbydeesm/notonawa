// Cinches: a rope tied between an upline and another upline, the body or
// another rope, that pulls the upline aside (pose-format.js has their
// format). Pure apart from three.js's math, so it's tested like the
// skeleton: everything here takes a skeleton already posed in the pose.
//
// A cinch's ends start where its spots are on the straight line of each
// rope's segment (ropePoint). As long as the gap between them, or longer,
// the cinch is taut and nothing moves. Shorter, the gap closes by the
// difference: an end on an upline's hanging stretch moves toward the
// other end (half each, if both are), and the upline bends there, in two
// straight runs; an end on the body or another rope stays where it is.

import { ROPE, isCinch, hangs } from "./pose-format.js";
import { ropePoint } from "./pose-skeleton.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./pose-format.js").Rope} Rope */
/** @typedef {import("./pose-format.js").RopePoint} RopePoint */
/** @typedef {import("./pose-skeleton.js").Skeleton} Skeleton */
/** @typedef {import("./vendor/three.js").Vector3} Vector3 */

/**
 * Whether a cinch's end is on an upline's hanging stretch (so it moves).
 * @param {Pose} pose @param {RopePoint} point
 */
const moves = (pose, [kind, rope, segment]) => kind === ROPE && hangs(pose.ropes[rope], segment);

/**
 * A cinch's ends: where they start (`from`), the gap between them, and
 * where they are once it pulls them in (`to`).
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @param {number} index the cinch's
 * @returns {{ from: [Vector3, Vector3], to: [Vector3, Vector3], gap: number }}
 */
export function cinchEnds(skeleton, pose, index) {
  const { p, l = 0 } = pose.ropes[index];
  const a = ropePoint(skeleton, p[0], pose);
  const b = ropePoint(skeleton, p[1], pose);
  const gap = a.distanceTo(b);
  const pull = Math.max(0, gap - l);
  const [ma, mb] = [moves(pose, p[0]), moves(pose, p[1])];
  const share = ma && mb ? pull / 2 : pull;
  // Each end moves its share of the way toward where the other began.
  const toward = (/** @type {Vector3} */ from, /** @type {Vector3} */ other, /** @type {boolean} */ moving) =>
    (moving && gap > 0 ? from.clone().lerp(other, share / gap) : from.clone());
  return { from: [a, b], to: [toward(a, b, ma), toward(b, a, mb)], gap };
}

/**
 * Where each cinched upline bends: by rope, the segment and the point.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @returns {Map<number, { segment: number, at: Vector3 }>}
 */
export function bends(skeleton, pose) {
  /** @type {Map<number, { segment: number, at: Vector3 }>} */
  const found = new Map();
  pose.ropes.forEach((rope, index) => {
    if (!isCinch(rope)) return;
    const { to } = cinchEnds(skeleton, pose, index);
    rope.p.forEach((point, end) => {
      if (moves(pose, point)) found.set(point[1], { segment: point[2], at: to[end] });
    });
  });
  return found;
}

/**
 * A rope's line in the room, point by point: a cinched upline with its
 * bend in it, a cinch from end to end as pulled.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @param {number} index
 * @param {Map<number, { segment: number, at: Vector3 }>} [bent] bends(), if already worked out
 * @returns {Vector3[]}
 */
export function ropeLine(skeleton, pose, index, bent = bends(skeleton, pose)) {
  const rope = pose.ropes[index];
  if (isCinch(rope)) return cinchEnds(skeleton, pose, index).to;
  const points = rope.p.map((p) => ropePoint(skeleton, p, pose));
  const bend = bent.get(index);
  if (bend) points.splice(bend.segment + 1, 0, bend.at);
  return points;
}

/**
 * A rope's line in the room as the runs it's drawn in: its stretches
 * hanging from the ring or bamboo each straight on their own (pulled taut,
 * a cinch's bend making two), the rest, round the body, curving through
 * their points.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @param {number} index
 * @param {Map<number, { segment: number, at: Vector3 }>} [bent]
 * @returns {Vector3[][]}
 */
export function ropeRuns(skeleton, pose, index, bent = bends(skeleton, pose)) {
  const rope = pose.ropes[index];
  if (isCinch(rope)) return [cinchEnds(skeleton, pose, index).to];
  const points = rope.p.map((p) => ropePoint(skeleton, p, pose));
  const bend = bent.get(index);
  /** @type {Vector3[][]} */
  const runs = [];
  /** @type {Vector3[]} */
  let curve = [];
  for (let segment = 0; segment + 1 < points.length; segment++) {
    const [a, b] = [points[segment], points[segment + 1]];
    if (!hangs(rope, segment)) {
      if (!curve.length) curve.push(a);
      curve.push(b);
      continue;
    }
    if (curve.length) runs.push(curve);
    curve = [];
    if (bend?.segment === segment) runs.push([a, bend.at], [bend.at, b]);
    else runs.push([a, b]);
  }
  if (curve.length) runs.push(curve);
  return runs;
}

/**
 * How long a segment of a rope is, through its bend if a cinch pulls it.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @param {number} index the rope's
 * @param {number} segment
 * @param {Map<number, { segment: number, at: Vector3 }>} [bent]
 */
export function segmentLength(skeleton, pose, index, segment, bent = bends(skeleton, pose)) {
  const { p } = pose.ropes[index];
  const a = ropePoint(skeleton, p[segment], pose);
  const b = ropePoint(skeleton, p[segment + 1], pose);
  const bend = bent.get(index);
  return bend?.segment === segment ? a.distanceTo(bend.at) + bend.at.distanceTo(b) : a.distanceTo(b);
}

/**
 * The spot on a rope nearest a point in the room (where it was tapped):
 * its segment and how far along it, 0 to 1.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @param {number} index the rope's
 * @param {Vector3} world
 * @returns {{ segment: number, along: number }}
 */
export function spotOn(skeleton, pose, index, world) {
  const { p } = pose.ropes[index];
  const points = p.map((point) => ropePoint(skeleton, point, pose));
  let best = { segment: 0, along: 0.5, distance: Infinity };
  for (let segment = 0; segment + 1 < points.length; segment++) {
    const a = points[segment];
    const ab = points[segment + 1].clone().sub(a);
    const length = ab.lengthSq();
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, world.clone().sub(a).dot(ab) / length));
    const distance = a.clone().addScaledVector(ab, t).distanceTo(world);
    if (distance < best.distance) best = { segment, along: t, distance };
  }
  return { segment: best.segment, along: best.along };
}
