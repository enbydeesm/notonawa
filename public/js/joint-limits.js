// Limits that depend on more than one movement of a joint: how far a
// shoulder or hip can twist or reach depends on where the arm or leg
// points. Each movement's own range is figure-rig.js's (and
// src/poses/parse.js's); these are on top of them. Pure, with no imports,
// so the server (src/poses/parse.js, src/pose-presets/parse.js) checks
// poses with this same file.
//
// Angles are the joint's own, in its moves' order: [forward, out, twist],
// whole degrees, the same for either side. The arm or leg points (for the
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
 * A limb joint's rules, for its angles [forward, out, twist]: the twist's
 * range, and whether the limb can point there at all.
 * @typedef {{ twist: (forward: number, out: number) => [number, number], reaches: (forward: number, out: number) => boolean }} Rules
 */

/** @type {Readonly<Record<"shoulder" | "hip", Rules>>} */
const RULES = Object.freeze({
  shoulder: {
    // A shoulder twists ±90° with the arm low, less as it rises past
    // shoulder height: about ±55° straight up.
    twist(forward, out) {
      const k = 1 - 0.4 * between((raised(forward, out) - 90) / 90, 0, 1);
      return [-90 * k, 90 * k];
    },
    // An arm swings back 70° hanging down, but once raised out to the
    // side only about 40° behind the body.
    reaches(forward, out) {
      const back = 70 - 30 * between((raised(forward, out) - 70) / 40, 0, 1);
      return forward >= -back;
    },
  },
  hip: {
    twist: () => /** @type {[number, number]} */ ([-45, 45]),
    // A leg goes out 90° once forward, but only 45° behind the body; and
    // it crosses the other only once it's forward.
    reaches(forward, out) {
      const outMost = 45 + 45 * between(forward / 30, 0, 1);
      const inMost = -15 - 15 * between((forward - 15) / 30, 0, 1);
      return out <= outMost && out >= inMost;
    },
  },
});

/**
 * Which rules a joint has, if any.
 * @param {string} joint e.g. "l_shoulder"
 */
const rulesFor = (joint) => RULES[/** @type {"shoulder" | "hip"} */ (joint.slice(2))] ?? null;

/**
 * Whether a joint's angles are a position a body can take.
 * @param {string} joint
 * @param {readonly number[]} angles
 */
export function canReach(joint, angles) {
  const rules = rulesFor(joint);
  if (!rules) return true;
  const [forward, out, twist] = angles;
  const [low, high] = rules.twist(forward, out);
  return rules.reaches(forward, out) && twist >= low - 1e-9 && twist <= high + 1e-9;
}

/**
 * A joint's angles brought within reach, whole degrees: the twist kept
 * within its range, and a limb pointing where it can't stopped where it
 * last could, on the way from `from` (a reachable position: what the
 * joint was, or at rest).
 * @param {string} joint
 * @param {readonly number[]} angles whole degrees, each within its own range
 * @param {readonly number[]} [from]
 * @returns {number[]}
 */
export function withinReach(joint, angles, from) {
  const rules = rulesFor(joint);
  if (!rules || canReach(joint, angles)) return [...angles];
  /** @param {readonly number[]} a */
  const twisted = ([forward, out, twist]) => {
    const [low, high] = rules.twist(forward, out);
    return [forward, out, Math.round(between(twist, Math.ceil(low), Math.floor(high)))];
  };
  const fixed = twisted(angles);
  if (canReach(joint, fixed)) return fixed;
  const start = from && canReach(joint, from) ? from : [0, 0, 0];
  // The furthest along the way from start that's still within reach.
  const at = (/** @type {number} */ t) => twisted(angles.map((a, i) => Math.round(start[i] + (a - start[i]) * t)));
  let low = 0, high = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (canReach(joint, at(mid))) low = mid; else high = mid;
  }
  for (let t = low; t > 0; t -= 0.01) if (canReach(joint, at(t))) return at(t);
  return twisted(start);
}
