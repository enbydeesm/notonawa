// Limits that depend on more than one movement of a joint: how far a
// shoulder or hip can twist or reach depends on where the arm or leg
// points. Each movement's own range is figure-rig.js's (and
// src/poses/parse.js's); these are on top of them. Pure, with no imports,
// so the server (src/poses/parse.js, src/pose-presets/parse.js) checks
// poses with this same file.
//
// Angles are the joint's own, in its moves' order ([forward, out, twist]
// for a shoulder or hip, [bend, twist] for a knee), whole degrees, the same
// for either side. A knee's twist depends on its bend and on the hip's
// twist (the two together turn the foot), so its rules see the pose's
// other joints too.
// The arm or leg points (for the
// figure's left; the right mirrors it)
//   (cos f · sin o, −cos f · cos o, sin f)
// with f forward and o out (figure-rig.js's turns: out, then forward, then
// the twist about the limb, which doesn't move where it points).

/** @param {number} n @param {number} low @param {number} high */
const between = (n, low, high) => Math.min(high, Math.max(low, n));
/** @param {number} degrees */
const rad = (degrees) => degrees * Math.PI / 180;

/**
 * How far the limb is raised from hanging straight down, degrees.
 * @param {number} forward @param {number} out
 */
export function raised(forward, out) {
  return Math.acos(between(Math.cos(rad(forward)) * Math.cos(rad(out)), -1, 1)) * 180 / Math.PI;
}

/**
 * A limb joint's rules, for its angles: the twist's range (its last
 * angle), given the others and the rest of the pose, and whether the limb
 * can point there at all.
 * @typedef {{
 *   at: number,
 *   twist: (angles: readonly number[], joints: Readonly<Record<string, readonly number[]>>, side: string) => [number, number],
 *   reaches: (angles: readonly number[]) => boolean,
 * }} Rules `at`: which angle is the twist
 */

/** The most a leg's hip and knee twist add up to, either way: how far a foot turns. */
const LEG_TWIST = 60;
/** The most a knee twists, bent right up; straight, it hardly does. */
const KNEE_TWIST = 35;

/** @type {Readonly<Record<"shoulder" | "hip" | "knee", Rules>>} */
const RULES = Object.freeze({
  shoulder: {
    at: 2,
    // A shoulder twists ±90° with the arm low, less as it rises past
    // shoulder height: about ±55° straight up.
    twist([forward, out]) {
      const k = 1 - 0.4 * between((raised(forward, out) - 90) / 90, 0, 1);
      return [-90 * k, 90 * k];
    },
    // An arm swings back 70° hanging down, but once raised out to the
    // side only about 40° behind the body.
    reaches([forward, out]) {
      const back = 70 - 30 * between((raised(forward, out) - 70) / 40, 0, 1);
      return forward >= -back;
    },
  },
  hip: {
    at: 2,
    // ±45°, and with the knee's no more than LEG_TWIST all told.
    twist(_angles, joints, side) {
      const knee = joints[`${side}_knee`]?.[1] ?? 0;
      return [Math.max(-45, -LEG_TWIST - knee), Math.min(45, LEG_TWIST - knee)];
    },
    // A leg goes out 90° once forward, but only 45° behind the body; and
    // it crosses the other only once it's forward.
    reaches([forward, out]) {
      const outMost = 45 + 45 * between(forward / 30, 0, 1);
      const inMost = -15 - 15 * between((forward - 15) / 30, 0, 1);
      return out <= outMost && out >= inMost;
    },
  },
  knee: {
    at: 1,
    // Hardly at all straight, up to KNEE_TWIST bent past 90°; and with the
    // hip's no more than LEG_TWIST all told.
    twist([bend], joints, side) {
      const most = KNEE_TWIST * between(bend / 90, 0, 1);
      const hip = joints[`${side}_hip`]?.[2] ?? 0;
      return [Math.max(-most, -LEG_TWIST - hip), Math.min(most, LEG_TWIST - hip)];
    },
    reaches: () => true,
  },
});

/**
 * Which rules a joint has, if any.
 * @param {string} joint e.g. "l_shoulder"
 */
const rulesFor = (joint) => RULES[/** @type {"shoulder" | "hip" | "knee"} */ (joint.slice(2))] ?? null;

/** @typedef {Readonly<Record<string, readonly number[]>>} Joints the pose's joints, by name */

/**
 * Whether a joint's angles are a position a body can take.
 * @param {string} joint
 * @param {readonly number[]} angles
 * @param {Joints} [joints] the rest of the pose (a knee's twist and a hip's depend on each other)
 */
export function canReach(joint, angles, joints = {}) {
  const rules = rulesFor(joint);
  if (!rules) return true;
  const twist = angles[rules.at] ?? 0;
  const [low, high] = rules.twist(angles, joints, joint.slice(0, 1));
  return rules.reaches(angles) && twist >= low - 1e-9 && twist <= high + 1e-9;
}

/**
 * A joint's angles brought within reach, whole degrees: the twist kept
 * within its range, and a limb pointing where it can't stopped where it
 * last could, on the way from `from` (a reachable position: what the
 * joint was, or at rest).
 * @param {string} joint
 * @param {readonly number[]} angles whole degrees, each within its own range
 * @param {readonly number[]} [from]
 * @param {Joints} [joints] the rest of the pose
 * @returns {number[]}
 */
export function withinReach(joint, angles, from, joints = {}) {
  const rules = rulesFor(joint);
  if (!rules || canReach(joint, angles, joints)) return [...angles];
  const side = joint.slice(0, 1);
  /** @param {readonly number[]} a the twist kept within its range */
  const twisted = (a) => {
    const [low, high] = rules.twist(a, joints, side);
    // A range shut by the rest of the pose leaves the twist at 0, or as near as it gets.
    const lo = Math.ceil(low), hi = Math.max(lo, Math.floor(high));
    const out = [...a];
    out[rules.at] = Math.round(between(a[rules.at] ?? 0, lo, hi));
    return out;
  };
  const fixed = twisted(angles);
  if (canReach(joint, fixed, joints)) return fixed;
  const start = from && canReach(joint, from, joints) ? from : angles.map(() => 0);
  // The furthest along the way from start that's still within reach.
  const at = (/** @type {number} */ t) => twisted(angles.map((a, i) => Math.round(start[i] + (a - start[i]) * t)));
  let low = 0, high = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (canReach(joint, at(mid), joints)) low = mid; else high = mid;
  }
  for (let t = low; t > 0; t -= 0.01) if (canReach(joint, at(t), joints)) return at(t);
  return twisted(start);
}
