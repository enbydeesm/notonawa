// A pose: the poser's figure, view and ropes, as numbers (src/poses/parse.js
// checks the same format; a unit test keeps the limits in step). Pure, so
// it's easy to test: making a pose, changing it, and undo/redo.
//
//   joints   each joint's angles (figure-rig.js), whole degrees
//   body     the whole body's pitch, yaw and roll, whole degrees
//   lift     how high the pelvis is off the floor, cm
//   camera   [yaw, pitch, distance, target height]: degrees and cm
//   ring     the hardpoint [x, y, z] in cm, or null
//   ropes    [{ c, w, p }]: a drawing's color and width, and points, each
//            [bone, x, y, z]: mm from that bone's joint, in the bone's own
//            directions, so a rope moves with the body; or ["ring", 0, 0, 0]
//
// Every change makes a new pose (one is never changed in place), so a
// history is just the poses before and after.

import { COLORS } from "./drawing-format.js";
import { JOINTS, STANDING_LIFT, LIFT_RANGE, clampJoint, restJoints } from "./figure-rig.js";

/** @typedef {import("./drawing-format.js").Color} Color */
/** @typedef {import("./drawing-format.js").Width} Width */
/** @typedef {[string, number, number, number]} RopePoint */
/** @typedef {{ c: Color, w: Width, p: RopePoint[] }} Rope */
/**
 * @typedef {{
 *   v: 1, joints: Record<string, number[]>, body: [number, number, number], lift: number,
 *   camera: [number, number, number, number], ring: [number, number, number] | null, ropes: Rope[],
 * }} Pose
 */

export { COLORS };
export const FORMAT_VERSION = 1;
export const RING = "ring";
/** Rope widths: a drawing's 1–3, as thin, medium and thick rope. */
export const WIDTHS = /** @type {const} */ ([1, 2, 3]);
/** The rope's radius for each width, in cm. */
export const ROPE_RADIUS = /** @type {const} */ ({ 1: 0.5, 2: 0.75, 3: 1.05 });

export const MAX_ROPES = 100;
export const MAX_ROPE_POINTS = 200;
export const MAX_POINTS = 3000;
export const MAX_POSES = 20;
/** How far a rope point can be from its bone, in mm, each way. */
export const OFFSET = 600;

/** The camera's limits: yaw, pitch, distance and target height. */
export const CAMERA = /** @type {const} */ ([[-180, 180], [-89, 89], [60, 900], [0, 350]]);
/** The ring's: x, y, z. */
export const RING_RANGE = /** @type {const} */ ([[-300, 300], [0, 450], [-300, 300]]);
/** Where a new ring goes: above the figure, at a typical hardpoint height. */
export const DEFAULT_RING = /** @type {[number, number, number]} */ ([0, 280, 0]);

/** @param {number} n @param {readonly [number, number]} range */
export const clamp = (n, [min, max]) => Math.min(max, Math.max(min, Math.round(n)));

/** @returns {Pose} the figure standing, seen from the front and a little above */
export function newPose() {
  return {
    v: FORMAT_VERSION, joints: restJoints(), body: [0, 0, 0], lift: STANDING_LIFT,
    camera: [25, 8, 330, 100], ring: null, ropes: [],
  };
}

/**
 * A pose as saved, made whole: every joint listed and within its limits
 * (older or partial poses, e.g. from an import, open like this).
 * @param {Partial<Pose>} saved
 * @returns {Pose}
 */
export function readPose(saved) {
  const fresh = newPose();
  const joints = restJoints();
  for (const j of JOINTS) {
    const angles = saved.joints?.[j.name];
    if (Array.isArray(angles)) joints[j.name] = clampJoint(j.name, angles);
  }
  return {
    ...fresh, ...saved, v: FORMAT_VERSION, joints,
    ropes: (saved.ropes ?? []).map((r) => ({ ...r, p: r.p.map((p) => /** @type {RopePoint} */ ([...p])) })),
  };
}

/**
 * @param {Pose} pose
 * @param {string} name
 * @param {number} index which of the joint's movements
 * @param {number} angle
 * @returns {Pose}
 */
export function setJoint(pose, name, index, angle) {
  const angles = [...pose.joints[name]];
  angles[index] = angle;
  return { ...pose, joints: { ...pose.joints, [name]: clampJoint(name, angles) } };
}

/**
 * @param {Pose} pose
 * @param {number} index 0 pitch, 1 yaw, 2 roll
 * @param {number} angle
 * @returns {Pose}
 */
export function setBody(pose, index, angle) {
  const body = /** @type {[number, number, number]} */ ([...pose.body]);
  body[index] = clamp(angle, [-180, 180]);
  return { ...pose, body };
}

/** @param {Pose} pose @param {number} lift @returns {Pose} */
export const setLift = (pose, lift) => ({ ...pose, lift: clamp(lift, LIFT_RANGE) });

/**
 * The view, kept within its limits (yaw goes round and round).
 * @param {Pose} pose
 * @param {[number, number, number, number]} camera
 * @returns {Pose}
 */
export function setCamera(pose, [yaw, pitch, distance, height]) {
  const wrapped = ((Math.round(yaw) % 360) + 540) % 360 - 180;
  return {
    ...pose,
    camera: [wrapped, clamp(pitch, CAMERA[1]), clamp(distance, CAMERA[2]), clamp(height, CAMERA[3])],
  };
}

/**
 * The ring moved, added (at DEFAULT_RING) or taken away. Taking it away
 * also takes every rope point on it, and any rope left too short.
 * @param {Pose} pose
 * @param {[number, number, number] | null} ring
 * @returns {Pose}
 */
export function setRing(pose, ring) {
  if (ring) {
    return { ...pose, ring: /** @type {[number, number, number]} */ (ring.map((n, i) => clamp(n, RING_RANGE[i]))) };
  }
  const ropes = pose.ropes.map((r) => ({ ...r, p: r.p.filter((p) => p[0] !== RING) })).filter((r) => r.p.length >= 2);
  return { ...pose, ring: null, ropes };
}

/** How many rope points a pose has, all its ropes together. @param {Pose} pose */
export const pointCount = (pose) => pose.ropes.reduce((n, r) => n + r.p.length, 0);

/**
 * A point where the rope touches a bone: its offset rounded to whole mm and
 * kept within reach (a rope point is never far off the body).
 * @param {string} bone
 * @param {[number, number, number]} mm
 * @returns {RopePoint}
 */
export const bonePoint = (bone, mm) => /** @type {RopePoint} */ ([bone, ...mm.map((n) => clamp(n, [-OFFSET, OFFSET]))]);

/** @type {RopePoint} */
export const RING_POINT = [RING, 0, 0, 0];

/**
 * Why a point can't be added to a rope, or null if it can.
 * @param {Pose} pose
 * @param {Rope | null} rope the rope being laid, or null for a new one
 * @returns {string | null}
 */
export function cantAdd(pose, rope) {
  if (!rope && pose.ropes.length >= MAX_ROPES) return `A pose can have at most ${MAX_ROPES} ropes.`;
  if (rope && rope.p.length >= MAX_ROPE_POINTS) return `A rope can have at most ${MAX_ROPE_POINTS} points. Start a new one.`;
  if (pointCount(pose) >= MAX_POINTS) return "This pose has as many rope points as it can hold.";
  return null;
}

/**
 * The same point twice in a row adds nothing (a double tap).
 * @param {RopePoint} a @param {RopePoint} b
 */
const samePoint = (a, b) => a[0] === b[0] && Math.hypot(a[1] - b[1], a[2] - b[2], a[3] - b[3]) < 5;

/**
 * A rope being laid, with a point added. The rope isn't in the pose until
 * it has two points (finishRope).
 * @param {Rope} rope
 * @param {RopePoint} point
 * @returns {Rope}
 */
export function addPoint(rope, point) {
  const last = rope.p[rope.p.length - 1];
  if (last && samePoint(last, point)) return rope;
  return { ...rope, p: [...rope.p, point] };
}

/**
 * The pose with a rope added, if it has at least two points (a single tap
 * isn't a rope).
 * @param {Pose} pose
 * @param {Rope} rope
 * @returns {Pose}
 */
export const finishRope = (pose, rope) => (rope.p.length >= 2 ? { ...pose, ropes: [...pose.ropes, rope] } : pose);

/** @param {Pose} pose @param {number} index @returns {Pose} */
export const removeRope = (pose, index) => ({ ...pose, ropes: pose.ropes.filter((_, i) => i !== index) });

/**
 * A preset's figure (figure-rig.js) on this pose: its ropes, ring and view
 * are kept.
 * @param {Pose} pose
 * @param {import("./figure-rig.js").Posture} posture
 * @returns {Pose}
 */
export const withPosture = (pose, { joints, body, lift }) => ({ ...pose, joints, body, lift });

/**
 * Whether two poses are the same (for "discard your changes?").
 * @param {Pose} a @param {Pose} b
 */
export const samePose = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- undo and redo -----------------------------------------------------------

/** How many changes undo can go back. */
export const MAX_UNDO = 200;

/** @typedef {{ past: Pose[], pose: Pose, future: Pose[] }} History */

/** @param {Pose} pose @returns {History} */
export const startHistory = (pose) => ({ past: [], pose, future: [] });

/**
 * The history after a change (a change to the same pose isn't one).
 * @param {History} history
 * @param {Pose} pose
 * @returns {History}
 */
export function change(history, pose) {
  if (samePose(history.pose, pose)) return history;
  return { past: [...history.past, history.pose].slice(-MAX_UNDO), pose, future: [] };
}

/**
 * The view changing isn't a change to undo: it's carried through the
 * history, so undoing a bend doesn't swing the view back.
 * @param {History} history
 * @param {Pose} pose the pose with its new view
 * @returns {History}
 */
export const look = (history, pose) => ({ ...history, pose });

/** @param {History} history @returns {History} */
export function undo(history) {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1), pose: { ...previous, camera: history.pose.camera },
    future: [history.pose, ...history.future],
  };
}

/** @param {History} history @returns {History} */
export function redo(history) {
  const [next, ...future] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.pose], pose: { ...next, camera: history.pose.camera }, future };
}
