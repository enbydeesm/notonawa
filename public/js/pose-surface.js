// Rope on the skin: the way round the body between two points of a rope,
// and a wrap round an arm, a leg or the trunk. Pure apart from three.js's
// math.
//
// The body here is its capsules (pose-contact.js), not its mesh: quick,
// and the same anywhere it's worked out. A rope's own points are where
// they were tapped, on the real skin; between two on the same part (or
// both on the trunk), the rope goes round the part's middle line, turning
// from one point's side to the other's the short way, as far out as the
// points are, and never inside a capsule. So a rope from the front of an
// arm to its back goes round it, not through it. Between points on
// different parts it runs straight, lifted out of any capsule in its way.
//
// The capsules only fit the body on average: they stand out past the skin
// where it curves in (the small of the back) or narrows (an ankle). A rope's
// points are on the real skin, so where either of two is inside one of its
// own part's capsules, the way between them isn't lifted out of that one:
// it stays on the line round the part between them, as their own points
// do, rather than jutting out to the capsule in a zig-zag.

import { Vector3 } from "./vendor/three.js";
import { SEGMENTS } from "./figure-body.js";
import { capsules, SEGMENT_OF } from "./pose-contact.js";

/** @typedef {import("./pose-skeleton.js").Skeleton} Skeleton */
/** @typedef {{ a: Vector3, b: Vector3, r: number, f: Vector3 }} Capsule */
/** @typedef {{ groups: Capsule[][] }} Skin the body's capsules, posed */
/** A part's middle line, and two directions across it to measure the way round from. @typedef {{ o: Vector3, d: Vector3, e1: Vector3, e2: Vector3, caps: Capsule[] }} Axis */

/** How far off a capsule a rope lies (cm): about a rope's own radius. */
const GAP = 0.7;
/** The most of a turn between two points drawn along it (radians), and the furthest apart (cm). */
const TURN = 25 * Math.PI / 180;
const REACH = 7;
/** The most points added between two. */
const MOST = 10;
/** Points to a turn of a wrap. */
export const WRAP_POINTS = 12;
/** The most turns a wrap has. */
export const MAX_WRAPS = 4;

const TORSO = Object.freeze(["hips", "waist", "chest"]);

/**
 * A rope point's part's segment (a toe's is its foot's; the Hips joint's,
 * the hips').
 * @param {string} part a rope point's bone
 * @returns {number} its index in SEGMENTS, or -1 (a hardpoint, a spot on a rope)
 */
function segmentOf(part) {
  const name = /** @type {Record<string, string>} */ (SEGMENT_OF)[part] ?? (part === "hips" ? "hips" : /_toes$/.test(part) ? `${part[0]}_foot` : "");
  return SEGMENTS.findIndex((s) => s.name === name);
}

/**
 * The body's capsules as posed, for the ropes drawn on it.
 * @param {Skeleton} skeleton posed
 * @returns {Skin}
 */
export const skinOf = (skeleton) => ({ groups: capsules(skeleton) });

/** A capsule group's middle one. @param {Capsule[]} group */
const middle = (group) => group[Math.floor(group.length / 2)];

/**
 * The line round which a rope turns between two parts: one part's own, or
 * the whole trunk's when both are on it; null for two different limbs.
 * @param {Skin} skin @param {number} i @param {number} j segments
 * @returns {Axis | null}
 */
function axisFor({ groups }, i, j) {
  const torso = TORSO.includes(SEGMENTS[i].name) && TORSO.includes(SEGMENTS[j].name);
  if (i !== j && !torso) return null;
  const [low, high] = i === j ? [i, i] : [Math.min(i, j), Math.max(i, j)];
  const first = middle(groups[low]), last = middle(groups[high]);
  const d = last.b.clone().sub(first.a);
  if (d.length() < 1e-6) return null;
  d.multiplyScalar(1 / d.length());
  // Across it: the way the part faces, squared off to the line.
  const e1 = first.f.clone().addScaledVector(d, -first.f.dot(d));
  if (e1.length() < 1e-6) return null;
  e1.multiplyScalar(1 / e1.length());
  const caps = [];
  for (let k = low; k <= high; k++) caps.push(...groups[k]);
  // The third: across both (d × e1).
  const e2 = new Vector3(d.y * e1.z - d.z * e1.y, d.z * e1.x - d.x * e1.z, d.x * e1.y - d.y * e1.x);
  return { o: first.a.clone(), d, e1, e2, caps };
}

/** A point as how far along the line, which way round and how far out. @param {Axis} axis @param {Vector3} p */
function round(axis, p) {
  const q = p.clone().sub(axis.o);
  const s = q.dot(axis.d);
  q.addScaledVector(axis.d, -s);
  return { s, turn: Math.atan2(q.dot(axis.e2), q.dot(axis.e1)), out: q.length() };
}

/** @param {Axis} axis @param {number} s @param {number} turn @param {number} out */
const at = (axis, s, turn, out) => axis.o.clone().addScaledVector(axis.d, s)
  .addScaledVector(axis.e1, Math.cos(turn) * out).addScaledVector(axis.e2, Math.sin(turn) * out);

/**
 * A point moved out of any of the capsules it's inside (or nearer than a
 * rope's radius to), straight out from each one's line.
 * @param {Vector3} p changed in place
 * @param {readonly Capsule[]} caps
 * @returns {Vector3} p
 */
export function liftedOut(p, caps) {
  for (const { a, b, r } of caps) {
    const ab = b.clone().sub(a);
    const length = ab.lengthSq();
    const t = length === 0 ? 0 : Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / length));
    const nearest = a.clone().addScaledVector(ab, t);
    const away = p.distanceTo(nearest);
    if (away >= r + GAP || away < 1e-6) continue;
    p.sub(nearest).multiplyScalar((r + GAP) / away).add(nearest);
  }
  return p;
}

/** The furthest the skin is looked for from a part's middle line (cm). */
const FAR = 45;

/**
 * Whether a point is inside a capsule, or within `margin` of it.
 * @param {Vector3} p @param {Capsule} capsule @param {number} [margin]
 */
function inside(p, { a, b, r }, margin = 0) {
  const ab = b.clone().sub(a);
  const length = ab.lengthSq();
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / length));
  return p.distanceTo(a.clone().addScaledVector(ab, t)) < r + margin;
}

/**
 * The points to draw a rope through between two of its points on the
 * body, so it lies on the skin: none when they're close, or either isn't
 * on the body.
 * @param {Skin} skin
 * @param {string} partA @param {Vector3} a
 * @param {string} partB @param {Vector3} b
 * @returns {Vector3[]} between a and b, in order
 */
export function alongSkin(skin, partA, a, partB, b) {
  const [i, j] = [segmentOf(partA), segmentOf(partB)];
  if (i < 0 || j < 0) return [];
  const axis = axisFor(skin, i, j);
  if (!axis) {
    // Different parts: straight, out of any capsule in the way.
    const steps = Math.min(MOST, Math.ceil(a.distanceTo(b) / REACH)) - 1;
    const caps = [...skin.groups[i], ...skin.groups[j]];
    return Array.from({ length: Math.max(0, steps) }, (_, k) => liftedOut(a.clone().lerp(b, (k + 1) / (steps + 1)), caps));
  }
  const [from, to] = [round(axis, a), round(axis, b)];
  // The short way round.
  let turn = to.turn - from.turn;
  if (turn > Math.PI) turn -= 2 * Math.PI;
  if (turn <= -Math.PI) turn += 2 * Math.PI;
  const steps = Math.min(MOST, Math.ceil(Math.max(Math.abs(turn) / TURN, a.distanceTo(b) / REACH))) - 1;
  // Where an end is inside one of its own part's capsules (or as near as a
  // rope lies), the real skin is under that capsule's: the way between
  // keeps out of the rest.
  const under = (/** @type {Vector3} */ p, /** @type {number} */ segment, /** @type {Capsule} */ c) => skin.groups[segment].includes(c) && inside(p, c, GAP);
  const caps = axis.caps.filter((c) => !under(a, i, c) && !under(b, j, c));
  return Array.from({ length: Math.max(0, steps) }, (_, k) => {
    const t = (k + 1) / (steps + 1);
    return liftedOut(at(axis, from.s + (to.s - from.s) * t, from.turn + turn * t, from.out + (to.out - from.out) * t), caps);
  });
}

/**
 * Which stretch of the body a part belongs to: the trunk, the head, or an
 * arm or a leg. A wrap round a part lies on that stretch's skin, not on
 * whatever is beside it (an arm hanging by the chest).
 * @param {string} part a rope point's bone
 * @returns {string}
 */
export function stretchOf(part) {
  if (["pelvis", "hips", "spine", "chest"].includes(part)) return "trunk";
  if (part === "head") return "head";
  return `${part.slice(0, 2)}${/shoulder|elbow|wrist/.test(part) ? "arm" : "leg"}`;
}

/**
 * A wrap round a part of the body where it was tapped: points going round
 * its middle line from the tap, as far out as the tap where the body is as
 * wide, following the capsules where it's wider or narrower; with more
 * turns than one, each a rope's width along from the last.
 * @param {Skin} skin
 * @param {string} part the part tapped
 * @param {Vector3} tapped on its skin
 * @param {number} turns 1 to MAX_WRAPS
 * @param {number} pitch how far along each turn is from the last (cm)
 * @param {(from: Vector3, outward: Vector3) => number | null} [measure] how far out the real
 *   skin is from a point on the part's middle line, a given way (the 3D
 *   view's, pose-scene.js): the capsules are rounder than a chest or a
 *   thigh, and a wrap laid on them alone can sit under the skin
 * @returns {Vector3[]} from the tap round to above it again; empty if the part can't be wrapped
 */
export function wrapRound(skin, part, tapped, turns, pitch, measure) {
  const i = segmentOf(part);
  const axis = i < 0 ? null : axisFor(skin, i, i);
  if (!axis) return [];
  const from = round(axis, tapped);
  // How far out the capsules' skin is, a given way round: the furthest
  // point that way still inside one, and a rope's radius more.
  const skinAt = (/** @type {number} */ s, /** @type {number} */ turn) => {
    let out = 0;
    for (let far = FAR; far > 0; far -= 0.5) {
      const p = at(axis, s, turn, far);
      if (axis.caps.some((c) => inside(p, c))) {
        out = far;
        break;
      }
    }
    return out + GAP;
  };
  const scale = Math.min(1.5, Math.max(0.8, from.out / Math.max(skinAt(from.s, from.turn), 0.1)));
  const count = Math.round(Math.min(MAX_WRAPS, Math.max(1, turns)));
  const along = count > 1 ? pitch : 0;
  // One turn's distances out, measured once and used for every turn (they
  // are a rope's width apart): on the real skin where it can be measured.
  const outs = Array.from({ length: WRAP_POINTS }, (_, k) => {
    const turn = from.turn + 2 * Math.PI * k / WRAP_POINTS;
    const real = measure?.(at(axis, from.s, turn, 0), at(axis, 0, turn, 1).sub(axis.o));
    // The rope's middle is its own radius off the skin (a turn's pitch is a little over its width).
    return real ? real + Math.max(GAP, pitch / 2.2 + 0.1) : skinAt(from.s, turn) * scale;
  });
  return Array.from({ length: WRAP_POINTS * count + 1 }, (_, k) => {
    if (k === 0) return tapped.clone();
    const s = from.s + along * k / WRAP_POINTS;
    // Back over the tap, exactly as far out as it was.
    const out = k % WRAP_POINTS === 0 ? from.out : outs[k % WRAP_POINTS];
    return at(axis, s, from.turn + 2 * Math.PI * k / WRAP_POINTS, out);
  });
}
