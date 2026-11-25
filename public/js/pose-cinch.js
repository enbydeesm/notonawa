// Cinches: a rope tied through spots on uplines, other ropes or the body,
// that pulls the uplines aside (pose-format.js has their format); ropes
// added to another, which start at a spot on it; and slack, which makes
// hanging stretches sag. Pure apart from three.js's math, so it's tested
// like the skeleton: everything here takes a skeleton already posed in
// the pose.
//
// A cinch's points start where its spots are on the straight line of each
// rope's segment (ropePoint). As long as the line through them, or
// longer, the cinch is taut and nothing moves. Shorter, each point on an
// upline's hanging stretch moves toward the points beside it on the cinch,
// all the same share of the way, until the line is the cinch's length (a
// cinch of two points: one end moving to the other, or half each if both
// can); a point on the body or a rope that doesn't hang stays where it
// is. The upline bends at each point pulled, in straight runs. A cinch on
// no upline, only ropes round the body (two wraps of a harness, say),
// pulls its points on those ropes in the same way instead, and they bend
// there; its points on the body stay. An approximation: each cinch is
// worked out as if the others weren't pulling the same ropes.

import { Object3D, Vector3 } from "./vendor/three.js";
import { ROPE, isCinch, isAdded, hangs, sags, pullsUplines } from "./pose-format.js";
import { ropePoint, followsSkin, restPoint, skinPoint, makeSkeleton } from "./pose-skeleton.js";
import { alongSkin, skinOf } from "./pose-surface.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./pose-format.js").Rope} Rope */
/** @typedef {import("./pose-format.js").RopePoint} RopePoint */
/** @typedef {import("./pose-skeleton.js").Skeleton} Skeleton */
/** @typedef {{ segment: number, along: number, at: Vector3 }} Bend where a cinch pulls a rope: its segment, how far along (thousandths) and the point */
/** @typedef {Map<number, Bend[]>} Bends by rope, each rope's in order along it */
/** @typedef {import("./pose-surface.js").Skin} Skin */

/**
 * Which of a cinch's points move: its spots on uplines' hanging
 * stretches, or, if it's on none, its spots on ropes round the body.
 * @param {Pose} pose @param {Rope} cinch
 * @returns {boolean[]}
 */
function movingPoints(pose, cinch) {
  const uplines = pullsUplines(pose.ropes, cinch);
  return cinch.p.map(([kind, rope, segment]) => kind === ROPE && (!uplines || hangs(pose.ropes[rope], segment)));
}

/** A line's length, through its points. @param {Vector3[]} points */
const lineLength = (points) => points.reduce((sum, p, i) => (i ? sum + p.distanceTo(points[i - 1]) : 0), 0);

/**
 * A cinch's points: where they start (`from`), the length of the line
 * through them, and where they are once it pulls them in (`to`).
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @param {number} index the cinch's
 * @returns {{ from: Vector3[], to: Vector3[], span: number }}
 */
export function cinchPoints(skeleton, pose, index) {
  const { p, l = 0 } = pose.ropes[index];
  const from = p.map((point) => ropePoint(skeleton, point, pose));
  const span = lineLength(from);
  const moving = movingPoints(pose, pose.ropes[index]);
  // Where each moving point heads: the middle of the points beside it.
  const toward = from.map((point, i) => {
    const near = [from[i - 1], from[i + 1]].filter(Boolean);
    return near.reduce((sum, v) => sum.add(v), new Vector3()).multiplyScalar(1 / near.length);
  });
  const at = (/** @type {number} */ t) => from.map((point, i) => (moving[i] ? point.clone().lerp(toward[i], t) : point.clone()));
  if (span <= l || !moving.some(Boolean)) return { from, to: from.map((v) => v.clone()), span };
  // The furthest it pulls in: points moving toward each other meet partway
  // (two moving ends, halfway), so the shortest line along the way.
  let most = 0, shortest = span;
  for (let k = 1; k <= 40; k++) {
    const length = lineLength(at(k / 40));
    if (length < shortest) [most, shortest] = [k / 40, length];
  }
  if (shortest >= l) return { from, to: at(most), span };
  // As far along as makes the line the cinch's length.
  let low = 0, high = most;
  for (let k = 0; k < 30; k++) {
    const mid = (low + high) / 2;
    if (lineLength(at(mid)) > l) low = mid; else high = mid;
  }
  return { from, to: at(low), span };
}

/**
 * Where the cinches bend the ropes they pull.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @returns {Bends}
 */
export function bends(skeleton, pose) {
  /** @type {Bends} */
  const found = new Map();
  pose.ropes.forEach((rope, index) => {
    if (!isCinch(rope)) return;
    const { to } = cinchPoints(skeleton, pose, index);
    const moving = movingPoints(pose, rope);
    rope.p.forEach((point, k) => {
      if (!moving[k]) return;
      const list = found.get(point[1]) ?? [];
      list.push({ segment: point[2], along: point[3], at: to[k] });
      found.set(point[1], list);
    });
  });
  for (const list of found.values()) list.sort((a, b) => a.segment - b.segment || a.along - b.along);
  return found;
}

/** A segment's bends, in order along it. @param {Bends} bent @param {number} index @param {number} segment */
const bendsOn = (bent, index, segment) => (bent.get(index) ?? []).filter((b) => b.segment === segment).map((b) => b.at);

/**
 * Where a spot on a rope is as drawn: on its segment's line through any
 * bends, as far along that line as the spot is along the straight one.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @param {RopePoint} spot a ["rope", rope, segment, along] point
 * @param {Bends} [bent]
 * @returns {Vector3}
 */
export function spotPoint(skeleton, pose, spot, bent = bends(skeleton, pose)) {
  const [, index, segment, along] = spot;
  const rope = pose.ropes[index];
  const line = [pointAt(skeleton, pose, index, segment, bent), ...bendsOn(bent, index, segment), pointAt(skeleton, pose, index, segment + 1, bent)];
  // On a slack rope's hanging stretch, on the sag it's drawn with.
  const total = rope.k && sags(rope, segment) ? hangingLength(skeleton, pose, index, bent) : 0;
  let left = lineLength(line) * along / 1000;
  for (let k = 1; k < line.length; k++) {
    const step = line[k].distanceTo(line[k - 1]);
    if (left <= step || k === line.length - 1) {
      const t = step === 0 ? 0 : Math.min(1, left / step);
      if (!total) return line[k - 1].clone().lerp(line[k], t);
      return onSag(sagging(line[k - 1], line[k], /** @type {number} */ (rope.k) * step / total), t);
    }
    left -= step;
  }
  return line[0];
}

/** A point part way along a sagging run (as drawn: its 11 points joined). @param {Vector3[]} sag @param {number} t 0 to 1 */
function onSag(sag, t) {
  const at = t * (sag.length - 1);
  const k = Math.min(sag.length - 2, Math.floor(at));
  return sag[k].clone().lerp(sag[k + 1], at - k);
}

/**
 * How long a rope's hanging stretches are, through their bends: what its
 * slack is shared out by.
 * @param {Skeleton} skeleton @param {Pose} pose @param {number} index @param {Bends} bent
 */
function hangingLength(skeleton, pose, index, bent) {
  const rope = pose.ropes[index];
  let total = 0;
  for (let segment = 0; segment + 1 < rope.p.length; segment++) {
    if (!sags(rope, segment)) continue;
    total += lineLength([pointAt(skeleton, pose, index, segment, bent), ...bendsOn(bent, index, segment), pointAt(skeleton, pose, index, segment + 1, bent)]);
  }
  return total;
}

/**
 * A rope's point as drawn: an added rope's first, on the rope it's added
 * to as drawn (spotPoint); the rest where ropePoint has them.
 * @param {Skeleton} skeleton @param {Pose} pose @param {number} index @param {number} k @param {Bends} bent
 */
function pointAt(skeleton, pose, index, k, bent) {
  const rope = pose.ropes[index];
  const point = rope.p[k];
  return k === 0 && isAdded(rope) ? spotPoint(skeleton, pose, point, bent) : ropePoint(skeleton, point, pose);
}

/**
 * A rope's line in the room, point by point: a cinched upline with its
 * bends in it, a cinch through its points as pulled.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @param {number} index
 * @param {Bends} [bent] bends(), if already worked out
 * @returns {Vector3[]}
 */
export function ropeLine(skeleton, pose, index, bent = bends(skeleton, pose)) {
  const rope = pose.ropes[index];
  if (isCinch(rope)) return cinchPoints(skeleton, pose, index).to;
  /** @type {Vector3[]} */
  const points = [];
  rope.p.forEach((_, k) => {
    points.push(pointAt(skeleton, pose, index, k, bent));
    if (k + 1 < rope.p.length) points.push(...bendsOn(bent, index, k));
  });
  return points;
}

/**
 * A straight run sagging with slack: a curve (a parabola) hanging below
 * the line between its ends, as deep as `extra` cm of rope more than the
 * run makes it.
 * @param {Vector3} a
 * @param {Vector3} b
 * @param {number} extra cm
 * @returns {Vector3[]}
 */
export function sagging(a, b, extra) {
  const length = a.distanceTo(b);
  if (extra <= 0 || length < 1) return [a, b];
  const depth = Math.min(length / 2, Math.sqrt(3 * length * extra / 8));
  const along = b.clone().sub(a).multiplyScalar(1 / length);
  // Down, as far as it's across the run; a run hanging straight down bows forward instead.
  const down = new Vector3(0, -1, 0).addScaledVector(along, along.y);
  const sideways = down.length();
  const bow = sideways > 0.3 ? down.multiplyScalar(1 / sideways) : new Vector3(0, 0, 1).addScaledVector(along, -along.z);
  if (sideways <= 0.3) bow.multiplyScalar(1 / Math.max(bow.length(), 1e-6));
  return Array.from({ length: 11 }, (_, k) => {
    const t = k / 10;
    return a.clone().lerp(b, t).addScaledVector(bow, 4 * depth * t * (1 - t));
  });
}

/** The straight body's capsules for a shape, and the ways round laid on them, kept. @type {Map<string, { skin: Skin, ways: Map<string, Vector3[]> }>} */
const straight = new Map();

/**
 * The way round the body between two points on it, laid out on the
 * straight body, where the capsules fit it (worked out once for the shape
 * and the two points).
 * @param {Skeleton} skeleton @param {RopePoint} from @param {RopePoint} to
 * @returns {Vector3[]} on the straight body
 */
function straightWay(skeleton, from, to) {
  const shape = skeleton.shape.join();
  let kept = straight.get(shape);
  if (!kept) {
    const rest = makeSkeleton(new Object3D(), skeleton.shape);
    rest.pelvis.updateMatrixWorld(true);
    kept = { skin: skinOf(rest), ways: new Map() };
    if (straight.size >= 3) straight.delete(/** @type {string} */ (straight.keys().next().value));
    straight.set(shape, kept);
  }
  const key = `${from.join()}|${to.join()}`;
  let way = kept.ways.get(key);
  if (!way) {
    const rest = (/** @type {RopePoint} */ [bone, x, y, z, layer]) => restPoint(skeleton, bone, [x / 10, y / 10, z / 10], layer).p;
    way = alongSkin(kept.skin, from[0], rest(from), to[0], rest(to));
    if (kept.ways.size > 2000) kept.ways.clear();
    kept.ways.set(key, way);
  }
  return way;
}

/**
 * The points between two on the body, to lie on the skin: laid out on the
 * straight body and moved as the skin there is (pose-skin-bind.js), so the
 * rope bends and stretches with a bent waist or knee as if drawn on it;
 * on the capsules as posed until the skin's loaded. None when either end
 * isn't on the body.
 * @param {Skeleton} skeleton posed @param {RopePoint} from @param {RopePoint} to
 * @param {Vector3} a @param {Vector3} b their places as drawn
 * @param {() => Skin} skin the capsules as posed, if they're needed
 * @returns {Vector3[]}
 */
export function skinBetween(skeleton, from, to, a, b, skin) {
  if (!skeleton.bones.has(from[0]) || !skeleton.bones.has(to[0])) return [];
  if (!followsSkin()) return alongSkin(skin(), from[0], a, to[0], b);
  const parts = [from[0], to[0]];
  return straightWay(skeleton, from, to).map((p) => skinPoint(skeleton, parts, p));
}

/**
 * @param {Skeleton} skeleton @param {Rope} rope @param {number} segment
 * @param {Vector3} a @param {Vector3} b its ends as drawn
 * @param {() => Skin} skin
 */
const onSkin = (skeleton, rope, segment, a, b, skin) => skinBetween(skeleton, rope.p[segment], rope.p[segment + 1], a, b, skin);

/**
 * A rope's line in the room as the runs it's drawn in: its stretches
 * hanging from the ring or bamboo, or a rope of two points, each straight
 * on their own (pulled taut, a cinch's bends making more), sagging with the
 * rope's slack, the rest, round the body, curving through their points.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @param {number} index
 * @param {Bends} [bent]
 * @param {Skin} [given] the body's capsules, if already worked out (skinOf)
 * @returns {Vector3[][]}
 */
export function ropeRuns(skeleton, pose, index, bent = bends(skeleton, pose), given) {
  const rope = pose.ropes[index];
  if (isCinch(rope)) return [cinchPoints(skeleton, pose, index).to];
  /** The body's capsules, worked out once, when a stretch round the body needs them. @type {Skin | undefined} */
  let made = given;
  const skin = () => (made ??= skinOf(skeleton));
  const points = rope.p.map((_, k) => pointAt(skeleton, pose, index, k, bent));
  /** @type {Vector3[][]} */
  const runs = [];
  /** @type {Vector3[][]} */
  const hanging = [];
  /** @type {Vector3[]} */
  let curve = [];
  for (let segment = 0; segment + 1 < points.length; segment++) {
    const [a, b] = [points[segment], points[segment + 1]];
    if (!sags(rope, segment)) {
      // Round the body: curving through its points, and any bends a cinch
      // pulls in it.
      if (!curve.length) curve.push(a);
      const pulled = bendsOn(bent, index, segment);
      // Lying on the skin between its points (pose-surface.js), unless a
      // cinch has pulled it off.
      curve.push(...(pulled.length ? pulled : onSkin(skeleton, rope, segment, a, b, skin)), b);
      continue;
    }
    if (curve.length) runs.push(curve);
    curve = [];
    const line = [a, ...bendsOn(bent, index, segment), b];
    for (let k = 1; k < line.length; k++) {
      const run = [line[k - 1], line[k]];
      runs.push(run);
      hanging.push(run);
    }
  }
  if (curve.length) runs.push(curve);
  // Slack shared among the hanging runs by their length.
  if (rope.k && hanging.length) {
    const total = hanging.reduce((sum, [a, b]) => sum + a.distanceTo(b), 0);
    for (const run of hanging) {
      const share = total > 0 ? rope.k * run[0].distanceTo(run[1]) / total : 0;
      const sag = sagging(run[0], run[1], share);
      run.splice(0, run.length, ...sag);
    }
  }
  return runs;
}

/**
 * How long a segment of a rope is, through any bends cinches pull in it.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @param {number} index the rope's
 * @param {number} segment
 * @param {Bends} [bent]
 */
export function segmentLength(skeleton, pose, index, segment, bent = bends(skeleton, pose)) {
  const { p } = pose.ropes[index];
  return lineLength([ropePoint(skeleton, p[segment], pose), ...bendsOn(bent, index, segment), ropePoint(skeleton, p[segment + 1], pose)]);
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
