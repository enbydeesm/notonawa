// Poses: their format, limits and request parsing. Pure, so it's easy to
// test.
//
// A pose is a posed 3D figure, kept as numbers rather than a picture, so it
// can be opened and posed again, and its copies changed separately. It's
// plain JSON, which the server checks:
//   {
//     v: 1,
//     joints: { spine: [bend, side, twist], l_elbow: [bend], … },
//     body: [pitch, yaw, roll], lift,
//     camera: [yaw, pitch, distance, target height],
//     ring: [x, y, z] | null,
//     ropes: [{ c: "red", w: 2, p: [["l_elbow", x, y, z] | ["ring", 0, 0, 0], …] }, …],
//   }
// Angles are whole degrees within each joint's limits (JOINTS; the page's
// figure-rig.js has the same, with names and directions, kept in step by
// a unit test). Lengths are whole centimetres, except a rope point's
// offset, which is whole millimetres from its bone, so a rope stays on the
// body when the figure is posed again. c and w are a drawing's colors and
// widths (src/drawings/parse.js).

import { BadInput } from "../http.js";
import { parseCaption } from "../media/parse.js";
import { COLORS, WIDTHS } from "../drawings/parse.js";

// A caption is sealed in the browser, or empty, as a drawing's is.
export { parseCaption, COLORS, WIDTHS };

export const FORMAT_VERSION = 1;

/**
 * Each joint's angles, in order, as [min, max] whole degrees.
 * @type {Readonly<Record<string, readonly (readonly [number, number])[]>>}
 */
export const JOINTS = Object.freeze({
  spine: [[-30, 60], [-35, 35], [-40, 40]],
  chest: [[-25, 45], [-30, 30], [-40, 40]],
  head: [[-50, 70], [-45, 45], [-80, 80]],
  l_shoulder: [[-70, 180], [-30, 180], [-90, 90]],
  l_elbow: [[0, 150]],
  l_wrist: [[-80, 80], [-30, 30]],
  r_shoulder: [[-70, 180], [-30, 180], [-90, 90]],
  r_elbow: [[0, 150]],
  r_wrist: [[-80, 80], [-30, 30]],
  l_hip: [[-30, 140], [-30, 90], [-50, 50]],
  l_knee: [[0, 155]],
  l_ankle: [[-50, 30]],
  r_hip: [[-30, 140], [-30, 90], [-50, 50]],
  r_knee: [[0, 155]],
  r_ankle: [[-50, 30]],
});

/** What a rope point can be on: the pelvis, the part after each joint, or the ring. */
export const BONES = Object.freeze(["pelvis", ...Object.keys(JOINTS)]);
export const RING = "ring";

/** The body's pitch, yaw and roll, each in whole degrees. */
export const BODY_ANGLE = 180;
/** How high the pelvis is above the floor, in cm. */
export const LIFT = /** @type {const} */ ([0, 250]);
/** The camera: yaw, pitch, distance and target height (cm). */
export const CAMERA = /** @type {const} */ ([[-180, 180], [-89, 89], [60, 900], [0, 350]]);
/** The ring (hardpoint): x, y, z in cm. */
export const RING_RANGE = /** @type {const} */ ([[-300, 300], [0, 450], [-300, 300]]);
/** How far a rope point can be from its bone, in mm, each way. */
export const OFFSET = 600;

/** Ropes in one pose. */
export const MAX_ROPES = 100;
/** Points in one rope. */
export const MAX_ROPE_POINTS = 200;
/** Points in one pose, all its ropes together. */
export const MAX_POINTS = 3000;
/** Poses on one tie, plan or workshop. */
export const MAX_PER_ITEM = 20;
/** The largest request body: a pose at its limits, and a caption. */
export const MAX_BODY_BYTES = 256 * 1024;

/**
 * @typedef {[string, number, number, number]} RopePoint
 * @typedef {{ c: typeof COLORS[number], w: typeof WIDTHS[number], p: RopePoint[] }} Rope
 * @typedef {{
 *   v: 1, joints: Record<string, number[]>, body: [number, number, number], lift: number,
 *   camera: [number, number, number, number], ring: [number, number, number] | null, ropes: Rope[],
 * }} Pose
 */

// Made by the server with crypto.randomUUID().
const POSE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function parsePoseId(value) {
  if (typeof value !== "string" || !POSE_ID.test(value)) throw new BadInput("That isn't a pose id.");
  return value;
}

/**
 * Whether value is a whole number from min to max.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 */
const within = (value, min, max) => Number.isInteger(value) && /** @type {number} */ (value) >= min && /** @type {number} */ (value) <= max;

/**
 * A list of whole numbers, each within its range.
 * @param {unknown} value
 * @param {readonly (readonly [number, number])[]} ranges
 */
const fits = (value, ranges) => Array.isArray(value) && value.length === ranges.length &&
  value.every((n, i) => within(n, ranges[i][0], ranges[i][1]));

/**
 * A pose as sent, checked and rebuilt with only what the format has (so
 * nothing else sent along is stored). A joint left out is at rest (all 0).
 * @param {unknown} value
 * @returns {Pose}
 */
export function parsePose(value) {
  const bad = (/** @type {string} */ why) => new BadInput(`Couldn't save the pose: ${why}`);
  const doc = /** @type {Record<string, any>} */ (value);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw bad("it was missing.");
  if (doc.v !== FORMAT_VERSION) throw bad("it's from a newer version of NotoNawa. Reload the page and try again.");

  const sent = doc.joints;
  if (!sent || typeof sent !== "object" || Array.isArray(sent)) throw bad("it has no joints.");
  for (const name of Object.keys(sent)) {
    if (!Object.hasOwn(JOINTS, name)) throw bad("it has a joint NotoNawa doesn't know.");
  }
  /** @type {Record<string, number[]>} */
  const joints = {};
  for (const [name, ranges] of Object.entries(JOINTS)) {
    const angles = Object.hasOwn(sent, name) ? sent[name] : ranges.map(() => 0);
    if (!fits(angles, ranges)) throw bad("a joint is bent further than a body can.");
    joints[name] = [...angles];
  }

  const angle = /** @type {[number, number]} */ ([-BODY_ANGLE, BODY_ANGLE]);
  if (!fits(doc.body, [angle, angle, angle])) throw bad("the body's turn isn't in the right format.");
  if (!within(doc.lift, LIFT[0], LIFT[1])) throw bad("the figure is off the floor by too much.");
  if (!fits(doc.camera, CAMERA)) throw bad("the view isn't in the right format.");
  if (doc.ring !== null && !fits(doc.ring, RING_RANGE)) throw bad("the ring is out of reach.");

  if (!Array.isArray(doc.ropes)) throw bad("it has no rope list.");
  if (doc.ropes.length > MAX_ROPES) throw bad(`it has more than ${MAX_ROPES} ropes.`);
  const offset = /** @type {[number, number]} */ ([-OFFSET, OFFSET]);
  let points = 0;
  const ropes = doc.ropes.map((/** @type {any} */ r) => {
    if (!r || typeof r !== "object" || !COLORS.includes(r.c) || !WIDTHS.includes(r.w) || !Array.isArray(r.p)) {
      throw bad("a rope isn't in the right format.");
    }
    if (r.p.length < 2 || r.p.length > MAX_ROPE_POINTS) throw bad("a rope has too many or too few points.");
    const p = r.p.map((/** @type {any} */ point) => {
      if (!Array.isArray(point) || point.length !== 4) throw bad("a rope point isn't in the right format.");
      const [bone, ...xyz] = point;
      if (bone === RING) {
        if (doc.ring === null) throw bad("a rope goes to a ring that isn't there.");
        if (!xyz.every((n) => n === 0)) throw bad("a rope point isn't in the right format.");
      } else if (!BONES.includes(bone) || !fits(xyz, [offset, offset, offset])) {
        throw bad("a rope point is off the figure.");
      }
      return /** @type {RopePoint} */ ([bone, ...xyz]);
    });
    points += p.length;
    return { c: r.c, w: r.w, p };
  });
  if (points > MAX_POINTS) throw bad("it's too detailed to store.");

  const [pitch, yaw, roll] = doc.body;
  const [cameraYaw, cameraPitch, distance, height] = doc.camera;
  return {
    v: FORMAT_VERSION, joints, body: [pitch, yaw, roll], lift: doc.lift, camera: [cameraYaw, cameraPitch, distance, height],
    ring: doc.ring === null ? null : [doc.ring[0], doc.ring[1], doc.ring[2]], ropes,
  };
}

/**
 * An edit: a new pose, a new caption, or both (a field left out is kept).
 * @param {Record<string, any>} body
 * @returns {{ data?: Pose, caption?: string | null }}
 */
export function parseEdit(body) {
  /** @type {{ data?: Pose, caption?: string | null }} */
  const edit = {};
  if ("data" in body) edit.data = parsePose(body.data);
  if ("caption" in body) edit.caption = parseCaption(body.caption);
  if (!("data" in edit) && !("caption" in edit)) throw new BadInput("Nothing to change: send data or caption.");
  return edit;
}

/**
 * A new order for an item's poses: every one of their ids, once each,
 * first to last.
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseOrder(value) {
  if (!Array.isArray(value) || value.length > MAX_PER_ITEM) throw new BadInput("Expected the poses' ids in order.");
  const ids = value.map(parsePoseId);
  if (new Set(ids).size !== ids.length) throw new BadInput("Each pose can only be listed once.");
  return ids;
}
