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
//     shift: [across, front to back],
//     shape: [gender, muscle, weight, height],
//     camera: [yaw, pitch, distance, target height, target x, target z],
//     ring: [x, y, z] | null,
//     bamboo: [x, y, z, turn, length, inset] | null,
//     hashira: [x, z, turn] | null,
//     ropes: [{ c: "red", w: 2, p: [["l_elbow", x, y, z] | ["ring", 0, 0, 0]
//       | ["bamboo", along, 0, 0] | ["hashira", x, y, z]
//       | ["rope", rope, segment, along], …], l?: length, s?: true }, …],
//   }
// At most one of ring, bamboo and hashira (the hardpoint) is there. Older
// poses have a camera of four numbers (no sideways pan) and no bamboo or
// hashira, and no shift (where the whole figure stands); they're read as
// having none. A pose without a shape (the body's sliders: gender, muscle
// and weight 0 to 100, height in cm, SHAPE_RANGES; the page's
// figure-body.js has the same, kept in step by a unit test) is from the
// first, simpler figure, and is kept without one. An older bamboo has four numbers, read as OLDER_BAMBOO's
// length and inset (how far in from its ends it hangs).
// A rope with `l` (cm) is a cinch: two points, at least one a spot on
// another rope (its index, a segment of it, and thousandths along it)
// where it hangs from the ring or bamboo, the other on another rope or
// the body; a rope has one cinch at most, and a cinch isn't on a cinch.
// `s` marks a see-saw: a rope over the ring or bamboo once, from the body
// and back to it (public/js/pose-format.js says more).
// Angles are whole degrees within each joint's limits (JOINTS; the page's
// figure-rig.js has the same, with names and directions, kept in step by
// a unit test), and a shoulder or hip within the limits that depend on
// several of its movements (public/js/joint-limits.js, shared). Lengths are whole centimetres, except a rope point's
// offset, which is whole millimetres from its bone, so a rope stays on the
// body when the figure is posed again. A point on the bamboo is how far
// along it from its middle, and one on the hashira is where on the post,
// both in millimetres too. c and w are a drawing's colors and
// widths (src/drawings/parse.js).

import { BadInput } from "../http.js";
import { parseCaption } from "../media/parse.js";
import { COLORS, WIDTHS } from "../drawings/parse.js";
// The shoulders' and hips' limits that depend on several movements: the
// page's own file, so the two can't differ (pure, no imports).
import { canReach } from "../../public/js/joint-limits.js";

// A caption is sealed in the browser, or empty, as a drawing's is.
export { parseCaption, COLORS, WIDTHS };

export const FORMAT_VERSION = 1;

/**
 * Each joint's angles, in order, as [min, max] whole degrees.
 * @type {Readonly<Record<string, readonly (readonly [number, number])[]>>}
 */
export const JOINTS = Object.freeze({
  spine: [[-30, 60], [-35, 35], [-35, 35]],
  chest: [[-25, 45], [-30, 30], [-35, 35]],
  head: [[-50, 70], [-45, 45], [-80, 80]],
  l_shoulder: [[-70, 180], [-30, 180], [-90, 90]],
  l_elbow: [[0, 150]],
  l_wrist: [[-80, 80], [-30, 30]],
  r_shoulder: [[-70, 180], [-30, 180], [-90, 90]],
  r_elbow: [[0, 150]],
  r_wrist: [[-80, 80], [-30, 30]],
  l_hip: [[-30, 140], [-30, 90], [-45, 45]],
  l_knee: [[0, 155]],
  l_ankle: [[-50, 30]],
  r_hip: [[-30, 140], [-30, 90], [-45, 45]],
  r_knee: [[0, 155]],
  r_ankle: [[-50, 30]],
});

/** The body's sliders: gender, muscle, weight, height (cm). @type {readonly (readonly [number, number])[]} */
export const SHAPE_RANGES = Object.freeze([[0, 100], [0, 100], [0, 100], [150, 200]]);

/** What a rope point can be on: the pelvis, or the part after each joint (or a hardpoint). */
export const BONES = Object.freeze(["pelvis", ...Object.keys(JOINTS)]);
export const RING = "ring";
export const BAMBOO = "bamboo";
export const HASHIRA = "hashira";

/** The body's pitch, yaw and roll, each in whole degrees. */
export const BODY_ANGLE = 180;
/** How high the pelvis is above the floor, in cm. */
export const LIFT = /** @type {const} */ ([0, 250]);
/** Where the whole figure stands: across (x) and front to back (z), in cm. */
export const SHIFT_RANGE = /** @type {const} */ ([[-300, 300], [-300, 300]]);
/** The camera: yaw, pitch, distance, and the target's height, x and z (cm). */
export const CAMERA = /** @type {const} */ ([[-180, 180], [-89, 89], [60, 900], [0, 350], [-300, 300], [-300, 300]]);
/** The ring (a hardpoint): x, y, z in cm. */
export const RING_RANGE = /** @type {const} */ ([[-300, 300], [0, 450], [-300, 300]]);
/** The bamboo: its middle's x, y, z in cm, how far it's turned, its length and its hangers' inset, cm. */
export const BAMBOO_RANGE = /** @type {const} */ ([[-300, 300], [0, 450], [-300, 300], [-90, 90], [90, 215], [0, 102]]);
/** An older bamboo's length and inset, from before they could change. */
export const OLDER_BAMBOO = /** @type {const} */ ([150, 8]);
/** How near the middle a bamboo's hangers can come, each side, cm. */
export const BAMBOO_MIDDLE = 5;
/** A cinch's length, cm. */
export const CINCH_RANGE = /** @type {const} */ ([0, 1000]);
/** A cinch's point on another rope. */
export const ROPE = "rope";
/** The hashira (a post from the floor up): its x and z in cm, and its turn. */
export const HASHIRA_RANGE = /** @type {const} */ ([[-300, 300], [-300, 300], [-45, 45]]);
/** The hashira's width and height, in cm. */
export const HASHIRA_SIZE = /** @type {const} */ ({ width: 10, height: 450 });
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
 * @typedef {{ c: typeof COLORS[number], w: typeof WIDTHS[number], p: RopePoint[], l?: number, s?: true }} Rope
 * @typedef {{
 *   v: 1, joints: Record<string, number[]>, body: [number, number, number], lift: number, shift: [number, number], shape?: number[],
 *   camera: number[], ring: number[] | null, bamboo: number[] | null, hashira: number[] | null,
 *   ropes: Rope[],
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
    if (!fits(angles, ranges) || !canReach(name, angles)) throw bad("a joint is bent further than a body can.");
    joints[name] = [...angles];
  }

  const angle = /** @type {[number, number]} */ ([-BODY_ANGLE, BODY_ANGLE]);
  if (!fits(doc.body, [angle, angle, angle])) throw bad("the body's turn isn't in the right format.");
  if (!within(doc.lift, LIFT[0], LIFT[1])) throw bad("the figure is off the floor by too much.");
  const shift = doc.shift ?? [0, 0];
  if (!fits(shift, SHIFT_RANGE)) throw bad("the figure is moved too far.");
  const shape = doc.shape ?? null;
  if (shape !== null && !fits(shape, SHAPE_RANGES)) throw bad("the body's shape isn't in the right format.");
  // A camera of four numbers is from before sideways panning.
  const camera = Array.isArray(doc.camera) && doc.camera.length === 4 ? [...doc.camera, 0, 0] : doc.camera;
  if (!fits(camera, CAMERA)) throw bad("the view isn't in the right format.");
  const ring = doc.ring ?? null;
  const bamboo = Array.isArray(doc.bamboo) && doc.bamboo.length === 4 ? [...doc.bamboo, ...OLDER_BAMBOO] : doc.bamboo ?? null;
  const hashira = doc.hashira ?? null;
  if (ring !== null && !fits(ring, RING_RANGE)) throw bad("the ring is out of reach.");
  if (bamboo !== null && !fits(bamboo, BAMBOO_RANGE)) throw bad("the bamboo is out of reach.");
  if (bamboo !== null && bamboo[5] > Math.floor(bamboo[4] / 2) - BAMBOO_MIDDLE) throw bad("the bamboo's hangers are past its middle.");
  if (hashira !== null && !fits(hashira, HASHIRA_RANGE)) throw bad("the hashira is out of reach.");
  if ([ring, bamboo, hashira].filter((x) => x !== null).length > 1) throw bad("it can only have one of a ring, bamboo or hashira.");
  const along = /** @type {[number, number]} */ (bamboo === null ? [0, 0] : [-bamboo[4] * 5, bamboo[4] * 5]);
  const up = /** @type {[number, number]} */ ([0, HASHIRA_SIZE.height * 10]);

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
        if (ring === null) throw bad("a rope goes to a ring that isn't there.");
        if (!xyz.every((n) => n === 0)) throw bad("a rope point isn't in the right format.");
      } else if (bone === BAMBOO) {
        if (bamboo === null) throw bad("a rope goes to a bamboo that isn't there.");
        if (!fits(xyz, [along, [0, 0], [0, 0]])) throw bad("a rope point is off the bamboo.");
      } else if (bone === HASHIRA) {
        if (hashira === null) throw bad("a rope goes to a hashira that isn't there.");
        if (!fits(xyz, [offset, up, offset])) throw bad("a rope point is off the hashira.");
      } else if (bone === ROPE) {
        // Checked against the other ropes once they're all read.
        if (!fits(xyz, [[0, MAX_ROPES - 1], [0, MAX_ROPE_POINTS - 2], [1, 999]])) throw bad("a cinch isn't in the right format.");
      } else if (!BONES.includes(bone) || !fits(xyz, [offset, offset, offset])) {
        throw bad("a rope point is off the figure.");
      }
      return /** @type {RopePoint} */ ([bone, ...xyz]);
    });
    points += p.length;
    /** @type {Rope} */
    const rope = { c: r.c, w: r.w, p };
    if (r.l !== undefined) {
      if (!within(r.l, CINCH_RANGE[0], CINCH_RANGE[1]) || p.length !== 2) throw bad("a cinch isn't in the right format.");
      rope.l = r.l;
    } else if (p.some((point) => point[0] === ROPE)) {
      throw bad("a cinch isn't in the right format.");
    }
    if (r.s !== undefined) {
      if (r.s !== true) throw bad("a rope isn't in the right format.");
      rope.s = true;
    }
    return rope;
  });
  if (points > MAX_POINTS) throw bad("it's too detailed to store.");
  checkLinks(ropes, bad);

  const [pitch, yaw, roll] = doc.body;
  /** @param {number[] | null} list */
  const copy = (list) => (list === null ? null : [...list]);
  return {
    v: FORMAT_VERSION, joints, body: [pitch, yaw, roll], lift: doc.lift, shift: [shift[0], shift[1]],
    ...(shape === null ? {} : { shape: [...shape] }), camera: [...camera],
    ring: copy(ring), bamboo: copy(bamboo), hashira: copy(hashira), ropes,
  };
}

/**
 * Checks what the cinches are on, and the see-saws: a cinch on another rope
 * (not a cinch), one of its ends where that rope hangs from the ring or
 * bamboo, the other on the body or another rope; a rope with one cinch at
 * most; a see-saw over the ring or bamboo once, between two points on the
 * body.
 * @param {Rope[]} ropes
 * @param {(why: string) => BadInput} bad
 */
function checkLinks(ropes, bad) {
  const top = (/** @type {RopePoint} */ p) => p[0] === RING || p[0] === BAMBOO;
  /** @param {Rope} rope @param {number} segment */
  const hangs = (rope, segment) => top(rope.p[segment]) !== top(rope.p[segment + 1]);
  const cinched = new Set();
  for (const rope of ropes) {
    if (rope.s) {
      const tops = rope.p.flatMap((p, i) => (top(p) ? [i] : []));
      if (rope.l !== undefined || tops.length !== 1 || tops[0] === 0 || tops[0] === rope.p.length - 1) {
        throw bad("a see-saw rope doesn't go over the ring or bamboo.");
      }
    }
    if (rope.l === undefined) continue;
    const on = rope.p.filter((p) => p[0] === ROPE);
    if (rope.p.some((p) => p[0] === RING || p[0] === BAMBOO || p[0] === HASHIRA)) throw bad("a cinch isn't in the right format.");
    for (const [, i, segment] of on) {
      const target = ropes[i];
      if (!target || target.l !== undefined || segment + 1 >= target.p.length) throw bad("a cinch is on a rope that isn't there.");
      if (cinched.has(i)) throw bad("a rope has more than one cinch.");
      cinched.add(i);
    }
    if (!on.some(([, i, segment]) => hangs(ropes[i], segment))) throw bad("a cinch isn't on an upline.");
  }
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
