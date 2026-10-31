// Keeping limbs out of the body: the body as capsules (figure-body.js's
// SEGMENTS, sized for its shape), and how far a pose pushes one into
// another. A move is never stopped part-way: while it's made, the parts it
// pushes into each other are shown (clashingParts), and when it's let go
// it's settled (settleClashes): another limb, or the head, moves aside
// just enough; a limb pushed into the trunk, which doesn't move aside,
// comes back out to the nearest clear spot. Only what the move made worse
// counts, so a pose that starts touching (hands at the thighs, a box tie's
// forearms on the back) is left as it is. Approximate: capsules, not the
// skin, so a centimetre or so of overlap can show. Pure apart from
// three.js's math.

import { Vector3 } from "./vendor/three.js";
import { SEGMENTS, segmentSizes } from "./figure-body.js";
import { posed } from "./pose-skeleton.js";
import { setJoint, HASHIRA_SIZE } from "./pose-format.js";

/** @typedef {import("./pose-skeleton.js").Skeleton} Skeleton */
/** @typedef {import("./pose-format.js").Pose} Pose */

/**
 * How far two segments can overlap before it counts (cm): the skin gives a
 * little. An arm against the trunk gives more (capsules are rounder than a
 * body, and arms rest on it), most against the back, where a box tie's
 * forearms lie.
 */
const GIVE = 1.5;
const ARM_ON_TRUNK = 3;
const ARM_ON_BACK = 5;

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
 * How far a pair can overlap before it counts (cm).
 * @param {boolean} armOnTrunk an arm against the trunk
 * @param {Vector3} away from the trunk's nearest point to the arm's
 * @param {Vector3} facing the way the trunk faces
 * @returns {number}
 */
export const skinGive = (armOnTrunk, away, facing) => (!armOnTrunk ? GIVE : away.dot(facing) < 0 ? ARM_ON_BACK : ARM_ON_TRUNK);

/** Which pairs are an arm (first) against the trunk (second). */
const ARM_TRUNK = PAIRS.map(([i, j]) => ARM.includes(SEGMENTS[i].name.split("_")[1]) && TORSO.includes(SEGMENTS[j].name));

/**
 * The capsules, posed: each a line and its radius (the torso's three
 * apiece, side by side).
 * @param {Skeleton} skeleton posed
 * @returns {{ a: Vector3, b: Vector3, r: number, f: Vector3 }[][]} SEGMENTS order (f: the way its first bone faces)
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
    const f = bone.localToWorld(new Vector3(0, 0, 1)).sub(origin);
    return shifts.map((x) => {
      const by = bone.localToWorld(new Vector3(x, 0, forward)).sub(origin);
      return { a: a.clone().add(by), b: b.clone().add(by), r, f };
    });
  });
}

/**
 * The shortest distance between two line segments.
 * @param {Vector3} p1 @param {Vector3} q1 @param {Vector3} p2 @param {Vector3} q2
 */
export function segmentGap(p1, q1, p2, q2) {
  const [on1, on2] = closestPoints(p1, q1, p2, q2);
  return on1.sub(on2).length();
}

/**
 * The nearest points of two line segments to each other, one on each.
 * @param {Vector3} p1 @param {Vector3} q1 @param {Vector3} p2 @param {Vector3} q2
 * @returns {[Vector3, Vector3]}
 */
function closestPoints(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a < 1e-9 && e < 1e-9) return [p1.clone(), p2.clone()];
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
  return [p1.clone().addScaledVector(d1, s), p2.clone().addScaledVector(d2, t)];
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
      for (const y of caps[j]) {
        const [onX, onY] = closestPoints(x.a, x.b, y.a, y.b);
        const away = onX.clone().sub(onY);
        deepest = Math.max(deepest, x.r + y.r - away.length() - skinGive(ARM_TRUNK[k], away, y.f));
      }
    }
    out[k] = deepest;
  });
  return out;
}


/** How much deeper than before a pair can go before it counts as pushed in (cm). */
const SLACK = 0.3;

/**
 * The pairs a move pushed further into each other than they were.
 * @param {Float64Array} after @param {Float64Array} before
 * @returns {number[]} indices into PAIRS
 */
const pushedIn = (after, before) => [...after.keys()].filter((k) => after[k] > before[k] + SLACK);

/** How far, all told, pairs are pushed in past where they were (cm). @param {Float64Array} after @param {Float64Array} before */
const excess = (after, before) => after.reduce((sum, d, k) => sum + Math.max(0, d - before[k] - SLACK), 0);

/** Each body part's segment (figure-rig.js's parts: "pelvis" and the joints). */
const SEGMENT_OF = Object.freeze({
  pelvis: "hips", spine: "waist", chest: "chest", head: "head",
  ...Object.fromEntries(["l", "r"].flatMap((s) => [
    [`${s}_shoulder`, `${s}_upperarm`], [`${s}_elbow`, `${s}_forearm`], [`${s}_wrist`, `${s}_hand`],
    [`${s}_hip`, `${s}_thigh`], [`${s}_knee`, `${s}_shin`], [`${s}_ankle`, `${s}_foot`],
  ])),
});
/** @type {Readonly<Record<string, string>>} */
const PART_OF = Object.freeze(Object.fromEntries(Object.entries(SEGMENT_OF).map(([part, seg]) => [seg, part])));

/**
 * What moves aside to settle a clash: each limb (an arm at the shoulder
 * and elbow, a leg at the hip and knee) and the head (bending and
 * leaning). The trunk doesn't: bending it would carry both arms, the
 * head and their ropes with it.
 * @type {Readonly<Record<string, readonly [string, number][]>>}
 */
const GIVES = Object.freeze({
  head: [["head", 0], ["head", 1]],
  ...Object.fromEntries(["l", "r"].flatMap((s) => [
    [`${s}_arm`, [[`${s}_shoulder`, 0], [`${s}_shoulder`, 1], [`${s}_elbow`, 0]]],
    [`${s}_leg`, [[`${s}_hip`, 0], [`${s}_hip`, 1], [`${s}_knee`, 0]]],
  ])),
});

/** The limb (or head) a segment is part of, null for the trunk. @param {string} segment */
function limbOf(segment) {
  if (segment === "head") return "head";
  const [side, part] = segment.split("_");
  if (!part) return null;
  return `${side}_${ARM.includes(part) ? "arm" : "leg"}`;
}

/** The limb (or head) a joint moves, null for the trunk's. @param {string} joint */
const limbOfJoint = (joint) => (joint in SEGMENT_OF && joint !== "pelvis" ? limbOf(SEGMENT_OF[/** @type {keyof typeof SEGMENT_OF} */ (joint)]) : null);

/**
 * The parts a move has pushed into each other (both of each pair), to
 * show while it's being made.
 * @param {Skeleton} skeleton any (it's posed)
 * @param {Pose} before
 * @param {Pose} after
 * @param {Float64Array} [beforeDepths] before's depths, if already worked out
 * @returns {Set<string>} parts (figure-rig.js's names)
 */
export function clashingParts(skeleton, before, after, beforeDepths = depths(skeleton, before)) {
  const parts = new Set();
  for (const k of pushedIn(depths(skeleton, after), beforeDepths)) {
    for (const i of PAIRS[k]) parts.add(PART_OF[SEGMENTS[i].name]);
  }
  return parts;
}

/**
 * A pose with some angles changed a little at a time (a few degrees,
 * then fewer) while that pushes pairs less far in, preferring small
 * changes: settling a clash.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @param {Float64Array} before the depths to get back to
 * @param {readonly [string, number][]} angles
 * @param {number} cost how much a degree of change counts against a centimetre less pushed in
 * @param {number} [most] the most any angle changes (degrees)
 * @returns {Pose}
 */
function ease(skeleton, pose, before, angles, cost, most = Infinity) {
  const start = pose;
  const score = (/** @type {Pose} */ p) => excess(depths(skeleton, p), before)
    + cost * angles.reduce((sum, [name, i]) => sum + Math.abs(p.joints[name][i] - start.joints[name][i]), 0);
  let best = pose, bestScore = score(pose);
  for (const step of [6, 3, 1]) {
    for (let round = 0; round < 20 && bestScore > 0.05; round++) {
      /** @type {Pose | null} */
      let next = null;
      let nextScore = bestScore - 1e-6;
      for (const [name, i] of angles) {
        for (const by of [step, -step]) {
          if (Math.abs(best.joints[name][i] + by - start.joints[name][i]) > most) continue;
          const trial = setJoint(best, name, i, best.joints[name][i] + by);
          if (trial.joints[name][i] === best.joints[name][i]) continue;
          const s = score(trial);
          if (s < nextScore) [next, nextScore] = [trial, s];
        }
      }
      if (!next) break;
      [best, bestScore] = [next, nextScore];
      if (excess(depths(skeleton, best), before) === 0) return best;
    }
  }
  return best;
}

/**
 * How much a degree counts when the limb moved comes back, and when
 * another moves aside (which should move as little as it can), and the
 * most another moves aside: a head tilts away a little, and the limb
 * moved does the rest.
 */
const OWN_COST = 0.02;
const ASIDE_COST = 0.1;
/** @type {Readonly<Record<string, number>>} */
const ASIDE_MOST = Object.freeze({ head: 20 });
const LIMB_ASIDE_MOST = 30;

/**
 * A move settled when it's let go: if it pushed parts into each other,
 * another limb (or the head) the move didn't touch moves aside; what's
 * still pushed in after that is settled by the joints moved coming back
 * to the nearest clear spot. A move into the trunk (which doesn't move
 * aside) comes back first, so nothing else is moved for a clash that
 * coming back clears anyway.
 * @param {Skeleton} skeleton any (it's posed)
 * @param {Pose} before the pose before the move
 * @param {Pose} after the move
 * @param {readonly string[]} moved the joints the move turned
 * @returns {Pose}
 */
export function settleClashes(skeleton, before, after, moved) {
  const was = depths(skeleton, before);
  const worse = pushedIn(depths(skeleton, after), was);
  if (!worse.length) return after;
  const movedLimbs = new Set(moved.map(limbOfJoint));
  // The limbs on the other side of each clash, to move aside, and whether
  // any clash is with the trunk.
  const aside = new Set();
  let trunk = false;
  for (const k of worse) {
    for (const i of PAIRS[k]) {
      const limb = limbOf(SEGMENTS[i].name);
      if (!limb) trunk = true;
      else if (!movedLimbs.has(limb)) aside.add(limb);
    }
  }
  // The joints moved, all their movements, coming back out.
  const own = moved.flatMap((name) => after.joints[name].map((_, i) => /** @type {[string, number]} */ ([name, i])));
  const clear = (/** @type {Pose} */ p) => excess(depths(skeleton, p), was) === 0;
  let pose = after;
  if (trunk) pose = ease(skeleton, pose, was, own, OWN_COST);
  for (const limb of aside) {
    if (!clear(pose)) pose = ease(skeleton, pose, was, GIVES[limb], ASIDE_COST, ASIDE_MOST[limb] ?? LIMB_ASIDE_MOST);
  }
  if (!clear(pose)) pose = ease(skeleton, pose, was, own, OWN_COST);
  // Still clashing: the move taken back the way it came, only as far as
  // it has to (the pose before it was clear).
  if (!clear(pose)) pose = backTowards(skeleton, before, pose, was);
  return pose;
}

/**
 * As near `after` as it can be, on the way back to `before` (every joint
 * moved together), without anything pushed in further than before.
 * @param {Skeleton} skeleton
 * @param {Pose} before
 * @param {Pose} after
 * @param {Float64Array} was before's depths
 * @returns {Pose}
 */
function backTowards(skeleton, before, after, was) {
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
    if (excess(depths(skeleton, at(mid)), was) === 0) low = mid; else high = mid;
  }
  return low === 0 ? before : at(low);
}

/** How far behind the body a new hashira goes (cm, from the back to the post). */
const HASHIRA_GAP = 3;
/** The parts a new hashira goes behind: the trunk, the head and the arms (tied behind the back, say), not the legs. */
const BEHIND = [...TORSO, "head", ...["l", "r"].flatMap((s) => ARM.map((p) => `${s}_${p}`))].map(segment);

/**
 * Where a new hashira goes: just behind the body, its face square to the
 * body's back. A body lying face up or down (its back facing up or down)
 * has no "behind" on the floor, so the post goes where it always has.
 * @param {Skeleton} skeleton
 * @param {Pose} pose
 * @returns {[number, number, number] | null} x, z and turn, or null for the usual place
 */
export function behindBody(skeleton, pose) {
  posed(skeleton, pose);
  const caps = capsules(skeleton);
  const bone = /** @type {import("./vendor/three.js").Object3D} */ (skeleton.all.get(SEGMENTS[segment("waist")].a[0]));
  const forward = bone.localToWorld(new Vector3(0, 0, 1)).sub(bone.localToWorld(new Vector3()));
  forward.y = 0;
  if (forward.length() < 0.5) return null;
  forward.multiplyScalar(1 / forward.length());
  const hips = caps[segment("hips")];
  const middle = hips.reduce((sum, c) => sum.add(c.a).add(c.b), new Vector3()).multiplyScalar(1 / (hips.length * 2));
  middle.y = 0;
  // The furthest back any of them reaches, along the way the body faces.
  let back = 0;
  for (const i of BEHIND) {
    for (const c of caps[i]) {
      for (const p of [c.a, c.b]) back = Math.min(back, p.clone().sub(middle).dot(forward) - c.r);
    }
  }
  const at = middle.addScaledVector(forward, back - HASHIRA_GAP - HASHIRA_SIZE.width / 2);
  // A square post looks the same every quarter turn: the nearest to straight.
  const facing = Math.atan2(forward.x, forward.z) * 180 / Math.PI;
  const turn = facing - 90 * Math.round(facing / 90);
  return [Math.round(at.x), Math.round(at.z), Math.round(turn)];
}
