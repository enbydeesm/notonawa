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
// When the limb alone is well short of the target (its joints at their
// limits), the trunk joins in, a little: a leg tilts and turns the pelvis
// (the other leg kept pointing where it was, within its own limits, and
// the body kept on the floor); an arm bends, leans and turns the chest.
// Those count for more than the limb's own angles, so they move only as
// much as they must, and a drag moves each only so far from where it was
// when the drag began (TRUNK_CAPS); the Hips and Chest sliders have their
// full ranges. A drag never hikes the pelvis: that lifts the other foot.
// (The waist can't help a leg: it bends the trunk above the pelvis, which
// the legs hang from.) At first the trunk joined in 1 cm short, up to its
// sliders' full ranges and with a hike, the other leg's hip unlimited: a
// leg pulled the whole body round and the other foot off the floor.
//
// The solver nudges those angles a little at a time toward the target
// (damped least squares, with the angles' effect worked out by trying a
// small change in each), never past a joint's limits. A target out of
// reach gets the point as near as it can. Angles stay fractional while
// solving and are rounded to whole degrees, as poses keep them, at the end.

import { jointNamed, clampJoint } from "./figure-rig.js";
import { canReach } from "./joint-limits.js";
import { makeSkeleton, posed, onBone, withHips, keptLowest } from "./pose-skeleton.js";

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
    [`${s}_hip`, leg], [`${s}_knee`, knee], [`${s}_ankle`, knee], [`${s}_toes`, knee],
  ];
})));

/**
 * A joint's fractional angles kept within each movement's own range
 * (while solving: clampJoint would round them).
 * @param {string} name @param {readonly number[]} angles
 */
const clampExact = (name, angles) =>
  /** @type {import("./figure-rig.js").Joint} */ (jointNamed(name)).moves.map((m, i) => Math.min(m.max, Math.max(m.min, angles[i] ?? 0)));

/** @param {string} bone @returns {boolean} whether holding this part drags it */
export const canDrag = (bone) => bone in DRAG_CHAINS;

/**
 * The trunk's angles that join in once a limb alone can't reach, each with
 * how freely it moves (smaller: less) and how far a drag can take it from
 * where it was when the drag began (degrees, TRUNK_CAPS): for a leg, the
 * pelvis's tilt and turn (not its hike); for an arm, the chest's bend,
 * lean and turn.
 * @param {string} bone the part held
 * @returns {readonly [Angle, number, number][]}
 */
export function trunkFor(bone) {
  if (/_(hip|knee|ankle|toes)$/.test(bone)) return [[["hips", 0], 0.35, 15], [["hips", 2], 0.2, 10]];
  return [[["chest", 0], 0.35, 15], [["chest", 1], 0.35, 10], [["chest", 2], 0.35, 10]];
}

/** The other leg's hip, kept while a leg pulls the pelvis. @param {string} bone */
const otherHip = (bone) => (/_(hip|knee|ankle|toes)$/.test(bone) ? `${bone[0] === "l" ? "r" : "l"}_hip` : null);

/**
 * Every joint a drag of a part can change.
 * @param {string} bone
 * @returns {string[]}
 */
export function dragJoints(bone) {
  const other = otherHip(bone);
  return [...new Set([...DRAG_CHAINS[bone], ...trunkFor(bone).map(([angle]) => angle)].map(([name]) => name).concat(other ? [other, "spine"] : []))];
}

/** How far off the target (cm) the limb alone must stay before the trunk joins in. */
export const TRUNK_AFTER = 8;

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
 * @param {{ from?: Pose }} [options] from: the pose when the drag began
 *   (the trunk moves only so far from it; the poser calls this again on
 *   each move, from the last); pose if left out
 * @returns {Pose}
 */
export function dragTo(pose, bone, cm, target, { from = pose } = {}) {
  const limb = DRAG_CHAINS[bone];
  if (!limb) throw new Error(`Can't drag ${bone}`);
  /** @type {Record<string, number[]>} */
  const joints = Object.fromEntries(Object.entries(pose.joints).map(([name, a]) => [name, [...a]]));
  const trial = { ...pose, joints };
  /** How far a drag can take each trunk angle, by "joint.index". */
  const caps = new Map(trunkFor(bone).map(([[name, i], , cap]) => [`${name}.${i}`, cap]));
  // The other leg, kept pointing where it was as the pelvis turns.
  const other = otherHip(bone);
  const keptLeg = other ? { ...pose, joints: { ...pose.joints } } : null;

  /** Where the held point is with the angles as they are now. */
  const skeleton = spare ??= makeSkeleton();
  const held = () => {
    posed(skeleton, trial);
    return onBone(skeleton, bone, cm);
  };

  /**
   * Nudges the angles of a chain toward the target, each weighted (how
   * much it moves for its share of the work).
   * @param {readonly Angle[]} chain
   * @param {readonly number[]} weights
   */
  const solve = (chain, weights) => {
    const limits = chain.map(([name, i]) => {
      const move = /** @type {import("./figure-rig.js").Joint} */ (jointNamed(name)).moves[i];
      const cap = caps.get(`${name}.${i}`);
      if (cap === undefined) return [move.min, move.max];
      const began = from.joints[name]?.[i] ?? 0;
      return [Math.max(move.min, began - cap), Math.min(move.max, began + cap)];
    });
    /** @param {number} k @param {number} angle */
    const set = (k, angle) => {
      const [name, i] = chain[k];
      const was = joints[name][i];
      joints[name][i] = Math.min(limits[k][1], Math.max(limits[k][0], angle));
      if (name === "hips" && keptLeg && other) {
        // The other leg kept pointing where it was, if its hip can: if not,
        // the pelvis stays put rather than twisting that leg.
        const kept = withHips(keptLeg, joints.hips, [other], { exact: true }).joints[other];
        const allowed = clampJoint(other, kept, undefined, joints);
        if (kept.every((a, n) => Math.abs(a - allowed[n]) <= 1)) {
          joints[other] = kept;
          // The trunk stays upright too, the lower back bending to meet the
          // pelvis as far as the waist can (past that, it tips with it).
          joints.spine = clampExact("spine", withHips(keptLeg, joints.hips, ["spine"], { exact: true }).joints.spine);
        } else joints[name][i] = was;
      }
    };
    const get = (/** @type {number} */ k) => joints[chain[k][0]][chain[k][1]];
    const watched = other ? [...chain, /** @type {Angle} */ ([other, 0])] : chain;
    let distance = Infinity;
    for (let round = 0; round < ROUNDS; round++) {
      const at = held();
      const error = [target.x - at.x, target.y - at.y, target.z - at.z];
      distance = Math.hypot(...error);
      if (distance < CLOSE) break;
      // A short step toward a far target at a time, so the limb doesn't
      // overshoot into a fold (and a target out of reach is approached, not
      // flailed at).
      if (distance > STEP) error.forEach((e, i) => { error[i] = e * STEP / distance; });
      // How far the point moves for one degree of each angle (a column
      // each), scaled by its weight.
      const columns = chain.map((_, k) => {
        const was = get(k);
        // Probe away from a limit, so the change is real.
        const step = was + PROBE > limits[k][1] ? -PROBE : PROBE;
        set(k, was + step);
        const moved = held();
        set(k, was);
        const w = weights[k];
        return [w * (moved.x - at.x) / step, w * (moved.y - at.y) / step, w * (moved.z - at.z) / step];
      });
      const change = dampedSolve(columns, error);
      const before = snapshot(joints, watched);
      change.forEach((d, k) => set(k, get(k) + weights[k] * d));
      keepReachable(joints, before);
    }
    return distance;
  };

  // The limb alone first; then, still well short of the target, the trunk too.
  const trunk = trunkFor(bone);
  let used = limb;
  if (solve(limb, limb.map(() => 1)) > TRUNK_AFTER) {
    used = [...limb, ...trunk.map(([angle]) => angle)];
    solve(used, [...limb.map(() => 1), ...trunk.map(([, weight]) => weight)]);
  }
  const rounded = { ...pose.joints };
  for (const name of new Set([...used.map(([n]) => n), ...(other && used !== limb ? [other, "spine"] : [])])) {
    rounded[name] = clampJoint(name, joints[name], pose.joints[name], rounded);
  }
  const done = { ...pose, joints: rounded };
  // A pelvis hiked or turned can push the other foot into the floor: the
  // body's lowest point is kept where it was.
  return other && used !== limb ? keptLowest(skeleton, pose, done) : done;
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
  for (const [name, was] of Object.entries(before)) if (!canReach(name, joints[name], joints)) joints[name] = was;
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
