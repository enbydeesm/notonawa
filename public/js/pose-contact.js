// Keeping limbs out of the body: the body as capsules (figure-body.js's
// SEGMENTS, sized for its shape), and how far a pose pushes one into
// another. A change that pushes a limb further in than it was is stopped
// where it touches (sliders, dragging and the rope solver all ask), so
// a pose that starts touching (hands at the thighs, a box tie's forearms
// on the back) can still move. Approximate: capsules, not the skin, so a
// centimetre or so of overlap can show. Pure apart from three.js's math.

import { Vector3 } from "./vendor/three.js";
import { SEGMENTS, segmentSizes } from "./figure-body.js";
import { posed } from "./pose-skeleton.js";

/** @typedef {import("./pose-skeleton.js").Skeleton} Skeleton */
/** @typedef {import("./pose-format.js").Pose} Pose */

/** How far two segments can overlap before it counts (cm): the skin gives a little. */
const GIVE = 1.5;

/** @param {string} name */
const segment = (name) => SEGMENTS.findIndex((s) => s.name === name);
const TORSO = ["hips", "waist", "chest"];
const ARM = ["upperarm", "forearm", "hand"];
const LEG = ["thigh", "shin", "foot"];
/** A limb's segments next to each other (they meet at a joint, so always touch). */
const NEIGHBOURS = new Set(["upperarm/forearm", "forearm/hand", "thigh/shin", "shin/foot"]);

/**
 * The pairs of segments that mustn't go into each other: each arm and leg
 * against the trunk, the head and the other limbs; not a limb against its
 * own next segment, nor a thigh against the hips it hangs from.
 * @returns {[number, number][]}
 */
function pairs() {
  /** @type {[number, number][]} */
  const out = [];
  /** @param {string} a @param {string} b */
  const add = (a, b) => out.push([segment(a), segment(b)]);
  const limbs = ["l", "r"].flatMap((s) => [...ARM, ...LEG].map((p) => `${s}_${p}`));
  limbs.forEach((a, i) => {
    const [side, part] = a.split("_");
    for (const t of [...TORSO, "head"]) {
      if (part === "thigh" && t === "hips") continue;
      add(a, t);
    }
    for (const b of limbs.slice(i + 1)) {
      const [otherSide, other] = b.split("_");
      if (side === otherSide && (NEIGHBOURS.has(`${part}/${other}`) || NEIGHBOURS.has(`${other}/${part}`))) continue;
      add(a, b);
    }
  });
  return out;
}
const PAIRS = pairs();

/**
 * The capsules, posed: each a line and its radius (the torso's three
 * apiece, side by side).
 * @param {Skeleton} skeleton posed
 * @returns {{ a: Vector3, b: Vector3, r: number }[][]} SEGMENTS order
 */
export function capsules(skeleton) {
  const sizes = segmentSizes(skeleton.shape);
  /** @param {readonly string[]} names */
  const middle = (names) => {
    const sum = new Vector3();
    for (const n of names) sum.add(/** @type {import("./vendor/three.js").Object3D} */ (skeleton.all.get(n)).localToWorld(new Vector3()));
    return sum.multiplyScalar(1 / names.length);
  };
  return SEGMENTS.map((seg, i) => {
    const [r, forward, side] = [sizes[i * 3], sizes[i * 3 + 1], sizes[i * 3 + 2]];
    const b = middle(seg.b);
    const a = middle(seg.a).lerp(b, seg.from ?? 0);
    // Offsets in the segment's first bone's own directions, turned with it.
    const bone = /** @type {import("./vendor/three.js").Object3D} */ (skeleton.all.get(seg.a[0]));
    const origin = bone.localToWorld(new Vector3());
    const shifts = side > 0 ? [-side, 0, side] : [0];
    return shifts.map((x) => {
      const by = bone.localToWorld(new Vector3(x, 0, forward)).sub(origin);
      return { a: a.clone().add(by), b: b.clone().add(by), r };
    });
  });
}

/**
 * The shortest distance between two line segments.
 * @param {Vector3} p1 @param {Vector3} q1 @param {Vector3} p2 @param {Vector3} q2
 */
export function segmentGap(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a < 1e-9 && e < 1e-9) return r.length();
  if (a < 1e-9) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1.dot(r);
    if (e < 1e-9) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return p1.clone().addScaledVector(d1, s).sub(p2.clone().addScaledVector(d2, t)).length();
}

/**
 * How far a pose pushes each pair of segments into each other (cm,
 * beyond the skin's give), PAIRS order.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @returns {Float64Array}
 */
export function depths(skeleton, pose) {
  posed(skeleton, pose);
  const caps = capsules(skeleton);
  const out = new Float64Array(PAIRS.length);
  PAIRS.forEach(([i, j], k) => {
    let deepest = 0;
    for (const x of caps[i]) {
      for (const y of caps[j]) deepest = Math.max(deepest, x.r + y.r - segmentGap(x.a, x.b, y.a, y.b) - GIVE);
    }
    out[k] = deepest;
  });
  return out;
}

/** How far a pose pushes limbs into the body, all told (cm). @param {Skeleton} skeleton @param {Pose} pose */
export const overlap = (skeleton, pose) => depths(skeleton, pose).reduce((a, b) => a + b, 0);

/**
 * Whether no pair of segments is pushed further into each other than
 * before (a pair that eases off doesn't make up for one that doesn't).
 * @param {Float64Array} after @param {Float64Array} before
 */
export const noDeeper = (after, before) => after.every((d, k) => d <= before[k] + 0.05);

/**
 * A change kept out of the body: `after` if it pushes no limb further in
 * than `before` did, or else as far toward it as it can go before one
 * does (every joint's angles moved together, whole degrees).
 * @param {Skeleton} skeleton any (it's posed)
 * @param {Pose} before
 * @param {Pose} after the same but for its joints
 * @returns {Pose}
 */
export function keptOut(skeleton, before, after) {
  const was = depths(skeleton, before);
  if (noDeeper(depths(skeleton, after), was)) return after;
  /** @param {number} t */
  const at = (t) => ({
    ...after,
    joints: Object.fromEntries(Object.entries(after.joints).map(([name, angles]) => [
      name, angles.map((a, i) => Math.round(before.joints[name][i] + (a - before.joints[name][i]) * t)),
    ])),
  });
  let low = 0, high = 1;
  for (let k = 0; k < 10; k++) {
    const mid = (low + high) / 2;
    if (noDeeper(depths(skeleton, at(mid)), was)) low = mid; else high = mid;
  }
  return low === 0 ? before : at(low);
}
