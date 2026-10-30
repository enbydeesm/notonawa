// Dragging a limb (inverse kinematics): a point on an arm or a leg follows
// the finger, and the joints above it turn to get it there. Pure apart from
// three.js's math (pose-skeleton.js), so it's tested like the presets.
//
// Which joints move depends on the part held: the upper arm or thigh turns
// at the shoulder or hip alone; the forearm, hand, shin or foot also bends
// the elbow or knee. Only the shoulder's and hip's forward and out turns and
// the elbow's and knee's bend are used: the twists are left as they were,
// as turning them while dragging makes the limb roll unexpectedly.
//
// The solver nudges those angles a little at a time toward the target
// (damped least squares, with the angles' effect worked out by trying a
// small change in each), never past a joint's limits. A target out of
// reach gets the point as near as it can. Angles stay fractional while
// solving and are rounded to whole degrees, as poses keep them, at the end.

import { jointNamed, clampJoint } from "./figure-rig.js";
import { canReach } from "./joint-limits.js";
import { makeSkeleton, posed, onBone } from "./pose-skeleton.js";

/** @typedef {import("./vendor/three.js").Vector3} Vector3 */
/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {[string, number]} Angle a joint and which of its movements */

/**
 * The angles each part's drag moves, by the bone it is (the part held).
 * @type {Readonly<Record<string, readonly Angle[]>>}
 */
export const DRAG_CHAINS = Object.freeze(Object.fromEntries(["l", "r"].flatMap((s) => {
  const arm = /** @type {Angle[]} */ ([[`${s}_shoulder`, 0], [`${s}_shoulder`, 1]]);
  const leg = /** @type {Angle[]} */ ([[`${s}_hip`, 0], [`${s}_hip`, 1]]);
  const elbow = /** @type {Angle[]} */ ([...arm, [`${s}_elbow`, 0]]);
  const knee = /** @type {Angle[]} */ ([...leg, [`${s}_knee`, 0]]);
  return [
    [`${s}_shoulder`, arm], [`${s}_elbow`, elbow], [`${s}_wrist`, elbow],
    [`${s}_hip`, leg], [`${s}_knee`, knee], [`${s}_ankle`, knee],
  ];
})));

/** @param {string} bone @returns {boolean} whether holding this part drags it */
export const canDrag = (bone) => bone in DRAG_CHAINS;

/** How many rounds of nudging per target, and how close is close enough (cm). */
const ROUNDS = 40;
const CLOSE = 0.3;
/** The furthest the point is moved toward the target in one round (cm). */
const STEP = 6;
/** The small change tried in each angle, and the damping (degrees). */
const PROBE = 0.5;
const DAMPING = 0.3;

/** One skeleton, reused for every drag (made when first needed). @type {import("./pose-skeleton.js").Skeleton | null} */
let spare = null;

/**
 * Where a point on the screen's ray meets the flat surface through
 * `through` facing `normal`: where a dragged point goes, kept at the depth
 * it started at.
 * @param {{ origin: Vector3, direction: Vector3 }} ray
 * @param {Vector3} through
 * @param {Vector3} normal
 * @returns {Vector3 | null} null if the ray runs along the surface
 */
export function onPlane({ origin, direction }, through, normal) {
  const facing = normal.x * direction.x + normal.y * direction.y + normal.z * direction.z;
  if (Math.abs(facing) < 1e-6) return null;
  const t = (normal.x * (through.x - origin.x) + normal.y * (through.y - origin.y) + normal.z * (through.z - origin.z)) / facing;
  return origin.clone().addScaledVector(direction, t);
}

/**
 * A pose with the point held on a bone moved as near the target as the
 * joints allow.
 * @param {Pose} pose
 * @param {string} bone the part held (one of DRAG_CHAINS)
 * @param {[number, number, number]} cm the point held, from the bone's joint, in its own directions
 * @param {Vector3} target where it should go, in the room (cm)
 * @returns {Pose}
 */
export function dragTo(pose, bone, cm, target) {
  const chain = DRAG_CHAINS[bone];
  if (!chain) throw new Error(`Can't drag ${bone}`);
  /** @type {Record<string, number[]>} */
  const joints = Object.fromEntries(Object.entries(pose.joints).map(([name, a]) => [name, [...a]]));
  const trial = { ...pose, joints };
  const limits = chain.map(([name, i]) => {
    const move = /** @type {import("./figure-rig.js").Joint} */ (jointNamed(name)).moves[i];
    return [move.min, move.max];
  });

  /** Where the held point is with the angles as they are now. */
  const skeleton = spare ??= makeSkeleton();
  const held = () => {
    posed(skeleton, trial);
    return onBone(skeleton, bone, cm);
  };
  /** @param {number} k @param {number} angle */
  const set = (k, angle) => {
    const [name, i] = chain[k];
    joints[name][i] = Math.min(limits[k][1], Math.max(limits[k][0], angle));
  };
  const get = (/** @type {number} */ k) => joints[chain[k][0]][chain[k][1]];

  for (let round = 0; round < ROUNDS; round++) {
    const at = held();
    const error = [target.x - at.x, target.y - at.y, target.z - at.z];
    const distance = Math.hypot(...error);
    if (distance < CLOSE) break;
    // A short step toward a far target at a time, so the limb doesn't
    // overshoot into a fold (and a target out of reach is approached, not
    // flailed at).
    if (distance > STEP) error.forEach((e, i) => { error[i] = e * STEP / distance; });
    // How far the point moves for one degree of each angle (a column each).
    const columns = chain.map((_, k) => {
      const was = get(k);
      // Probe away from a limit, so the change is real.
      const step = was + PROBE > limits[k][1] ? -PROBE : PROBE;
      set(k, was + step);
      const moved = held();
      set(k, was);
      return [(moved.x - at.x) / step, (moved.y - at.y) / step, (moved.z - at.z) / step];
    });
    const change = dampedSolve(columns, error);
    const before = snapshot(joints, chain);
    change.forEach((d, k) => set(k, get(k) + d));
    keepReachable(joints, before);
  }
  const rounded = { ...pose.joints };
  for (const [name] of chain) rounded[name] = clampJoint(name, joints[name], pose.joints[name]);
  return { ...pose, joints: rounded };
}

/**
 * The angles of the joints in a chain, copied.
 * @param {Record<string, number[]>} joints
 * @param {readonly (readonly [string, number])[]} chain
 * @returns {Record<string, number[]>}
 */
export const snapshot = (joints, chain) => Object.fromEntries(chain.map(([name]) => [name, [...joints[name]]]));

/**
 * Takes back a step for any joint it took out of reach (a shoulder or
 * hip pointing or twisting where a body can't, joint-limits.js), so
 * solving stays within reach.
 * @param {Record<string, number[]>} joints changed in place
 * @param {Record<string, number[]>} before the angles before the step
 */
export function keepReachable(joints, before) {
  for (const [name, was] of Object.entries(before)) if (!canReach(name, joints[name])) joints[name] = was;
}

/**
 * The change in each angle that best moves the point by `error`, damped so
 * a joint near straight (where a small move does little) doesn't swing:
 * Jᵀ (J Jᵀ + λ² I)⁻¹ e, with J's columns given.
 * @param {number[][]} columns each angle's effect, [x, y, z] per degree
 * @param {number[]} error [x, y, z], cm
 * @returns {number[]} degrees
 */
export function dampedSolve(columns, error) {
  // J Jᵀ + λ² I, a 3 × 3.
  const m = [0, 1, 2].map((r) => [0, 1, 2].map((c) =>
    columns.reduce((sum, col) => sum + col[r] * col[c], 0) + (r === c ? DAMPING * DAMPING : 0)));
  const y = solve3(m, error);
  return columns.map((col) => col[0] * y[0] + col[1] * y[1] + col[2] * y[2]);
}

/**
 * Solves m · y = b for a 3 × 3 m (Cramer's rule; the damping keeps it from
 * being singular).
 * @param {number[][]} m
 * @param {number[]} b
 */
function solve3(m, b) {
  const det = (/** @type {number[][]} */ a) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
    + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  return [0, 1, 2].map((c) => det(m.map((row, r) => row.map((v, k) => (k === c ? b[r] : v)))) / d);
}
