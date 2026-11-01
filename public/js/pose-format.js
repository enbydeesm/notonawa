// A pose: the poser's figure, view and ropes, as numbers (src/poses/parse.js
// checks the same format; a unit test keeps the limits in step). Pure, so
// it's easy to test: making a pose, changing it, and undo/redo.
//
//   joints   each joint's angles (figure-rig.js), whole degrees
//   body     the whole body's pitch, yaw and roll, whole degrees
//   lift     how high the pelvis is off the floor, cm
//   shift    where the whole figure stands: [across, front to back], cm
//            (older poses have none, read as [0, 0])
//   shape    the body: [gender, muscle, weight, height in cm]
//            (figure-body.js). Older poses have none: they were posed on
//            the first, simpler figure, so they open on the in-between
//            body with their ropes moved onto it (readPose)
//   camera   [yaw, pitch, distance, target height, target x, target z]:
//            degrees and cm (older poses have the first four)
//   ring     a ring to tie uplines to: [x, y, z] in cm, or null
//   bamboo   a bamboo pole across, [x, y, z, turn, length, inset] (its
//            middle, degrees turned from lying left to right, its length,
//            and how far in from each end the two lines it hangs from
//            are, cm), or null. Older poses have the first four, read as
//            OLDER_BAMBOO's length and inset (what they looked like).
//   hashira  an upright post from the floor up, [x, z, turn], or null
//   ropes    [{ c, w, p }]: a drawing's color and width, and points, each
//            [bone, x, y, z]: mm from that bone's joint, in the bone's own
//            directions, so a rope moves with the body; or ["ring", 0, 0, 0];
//            ["bamboo", along, 0, 0], mm along it from its middle; or
//            ["hashira", x, y, z], mm from the foot of the post, in its
//            own directions; or, on a cinch, ["rope", rope, segment, along]:
//            a spot on another rope (its index in ropes), between its
//            points `segment` and `segment + 1`, `along` thousandths of
//            the way.
//            A cinch (one with `l`, its length in cm) is a rope tied
//            through two or more spots, on ropes (the same one or others)
//            or the body, at least one on an upline's hanging stretch
//            (between the ring or bamboo and the point next to it), which
//            it pulls in (pose-cinch.js). A rope can have any number of
//            cinches; a cinch is never on a cinch.
//            A rope added to another (not a cinch) starts at a spot on it,
//            ["rope", …] as its first point (on a rope before it in
//            `ropes`), and goes on as any rope does.
//            `k` (cm) is a rope's slack: its hanging stretches sag (drawn
//            only: nothing it's tied to moves).
//            `s` (true) marks a rope running over the ring or bamboo, from
//            the body and back to it: a see-saw, keeping its length as one
//            end moves (pose-constraints.js).
//
// Only one hardpoint (ring, bamboo or hashira) is there at a time.
//
// Every change makes a new pose (one is never changed in place), so a
// history is just the poses before and after.

import { COLORS } from "./drawing-format.js";
import { JOINTS, STANDING_LIFT, LIFT_RANGE, clampJoint, restJoints, startJoints, anchorBone, olderJointPlaces } from "./figure-rig.js";
import { BONES as BODY_BONES, DEFAULT_SHAPE, bodyHeads, cleanShape } from "./figure-body.js";

/** @typedef {import("./drawing-format.js").Color} Color */
/** @typedef {import("./drawing-format.js").Width} Width */
/** @typedef {[string, number, number, number]} RopePoint */
/**
 * A rope; `still` (a cinch's "Move the body" unticked) is the poser's
 * own, never saved (forSaving).
 * @typedef {{ c: Color, w: Width, p: RopePoint[], l?: number, s?: true, k?: number, still?: true }} Rope
 */
/** @typedef {[number, number, number, number, number, number]} Camera */
/** @typedef {"ring" | "bamboo" | "hashira"} Hardpoint */
/**
 * @typedef {{
 *   v: 1, joints: Record<string, number[]>, body: [number, number, number], lift: number, shift: [number, number],
 *   shape: import("./figure-body.js").Shape,
 *   camera: Camera, ring: number[] | null, bamboo: number[] | null, hashira: number[] | null,
 *   ropes: Rope[], marks?: import("./pose-marks.js").Marks,
 * }} Pose
 * `marks` are the poser's pencil marks (pose-marks.js), never saved.
 */

export { COLORS };
export const FORMAT_VERSION = 1;
export const RING = "ring";
export const BAMBOO = "bamboo";
export const HASHIRA = "hashira";
/** A cinch's point on another rope. */
export const ROPE = "rope";
/** @type {readonly Hardpoint[]} */
export const HARDPOINTS = Object.freeze([RING, BAMBOO, HASHIRA]);
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

/** The camera's limits: yaw, pitch, distance, and the target's height, x and z. */
export const CAMERA = /** @type {const} */ ([[-180, 180], [-89, 89], [60, 900], [0, 350], [-300, 300], [-300, 300]]);
/** The whole figure's shift: across (x) and front to back (z). */
export const SHIFT_RANGE = /** @type {const} */ ([[-300, 300], [-300, 300]]);
/** The ring's: x, y, z. */
export const RING_RANGE = /** @type {const} */ ([[-300, 300], [0, 450], [-300, 300]]);
/** The bamboo's: x, y, z of its middle, its turn, its length and its hangers' inset (also kept within maxInset). */
export const BAMBOO_RANGE = /** @type {const} */ ([[-300, 300], [0, 450], [-300, 300], [-90, 90], [90, 215], [0, 102]]);
/** The length and inset of an older pose's bamboo, from before they could change, cm. */
export const OLDER_BAMBOO = /** @type {const} */ ([150, 8]);
/** How near the middle a bamboo's hangers can come, each side, cm. */
export const BAMBOO_MIDDLE = 5;
/** A rope's slack, cm. */
export const SLACK_RANGE = /** @type {const} */ ([0, 100]);
/** A cinch's length, cm. */
export const CINCH_RANGE = /** @type {const} */ ([0, 1000]);
/** The hashira's: x, z, and its turn (a square post looks the same every 90°). */
export const HASHIRA_RANGE = /** @type {const} */ ([[-300, 300], [-300, 300], [-45, 45]]);
/** The hashira's width and height, cm: from the floor to as high as a hardpoint goes. */
export const HASHIRA_SIZE = /** @type {const} */ ({ width: 10, height: 450 });

/** Each hardpoint's limits, and where a new one goes. */
export const HARDPOINT_RANGES = /** @type {const} */ ({ ring: RING_RANGE, bamboo: BAMBOO_RANGE, hashira: HASHIRA_RANGE });
/**
 * A new ring or bamboo hangs above the figure, low enough to be in view; a
 * new hashira stands behind it, 12 cm from its back (the back is about
 * 10 cm behind the middle of the body, and the post 5 cm to its middle).
 * @type {Readonly<Record<Hardpoint, number[]>>}
 */
export const DEFAULT_HARDPOINTS = Object.freeze({ ring: [0, 195, 0], bamboo: [0, 195, 0, 0, 152, 30], hashira: [0, -27, 0] });

/**
 * The furthest in from its ends a bamboo's hangers can be: both stay on
 * their own side of the middle.
 * @param {number} length cm
 */
export const maxInset = (length) => Math.floor(length / 2) - BAMBOO_MIDDLE;

/** @param {number} n @param {readonly [number, number]} range */
export const clamp = (n, [min, max]) => Math.min(max, Math.max(min, Math.round(n)));

/**
 * A number typed into a slider's box, kept within the slider's range as a
 * whole number; null if it isn't a number (the box then shows the old one).
 * @param {string} text
 * @param {readonly [number, number]} range
 * @returns {number | null}
 */
export function typedNumber(text, range) {
  const trimmed = text.trim().replace(/^\u2212/, "-");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  return clamp(Number(trimmed), range);
}

/** @returns {Pose} the figure standing, seen from the front and a little above */
export function newPose() {
  return {
    v: FORMAT_VERSION, joints: startJoints(), body: [0, 0, 0], lift: STANDING_LIFT, shift: [0, 0], shape: [...DEFAULT_SHAPE],
    camera: [25, 8, 330, 100, 0, 0], ring: null, bamboo: null, hashira: null, ropes: [],
  };
}

/**
 * How far each part's rope points move from the first figure to the
 * in-between body, mm: its joint was there, the bone they're kept on is
 * here (both lined up with the world at rest, so it's a plain move).
 * @returns {Record<string, [number, number, number]>}
 */
function ropeShifts() {
  const older = olderJointPlaces();
  const heads = bodyHeads(DEFAULT_SHAPE);
  return Object.fromEntries(Object.entries(older).map(([part, [x, y, z]]) => {
    const i = BODY_BONES.indexOf(anchorBone(part)) * 3;
    return [part, [(x - heads[i]) * 10, (y - heads[i + 1]) * 10, (z - heads[i + 2]) * 10]];
  }));
}

/**
 * A pose's ropes from the first figure, on the in-between body: each point
 * on the body kept where it was on the first figure, standing.
 * @param {Rope[]} ropes
 * @returns {Rope[]}
 */
export function ropesOntoBody(ropes) {
  const shifts = ropeShifts();
  return ropes.map((r) => ({
    ...r,
    p: r.p.map((point) => {
      const shift = shifts[point[0]];
      if (!shift) return /** @type {RopePoint} */ ([...point]);
      return bonePoint(point[0], [point[1] + shift[0], point[2] + shift[1], point[3] + shift[2]]);
    }),
  }));
}

/**
 * A pose as saved, made whole: every joint listed and within its ranges
 * (older or partial poses, e.g. from an import, open like this). One saved
 * before the body had a shape gets the in-between one, its ropes moved
 * onto it.
 * @param {Partial<Pose>} saved
 * @returns {Pose}
 */
export function readPose(saved) {
  const fresh = newPose();
  const joints = restJoints();
  for (const j of JOINTS) {
    const angles = saved.joints?.[j.name];
    // Within each movement's range only: a pose made with collisions
    // allowed opens as it was saved.
    if (Array.isArray(angles)) joints[j.name] = clampJoint(j.name, angles, undefined, joints, false);
  }
  const camera = /** @type {Camera} */ ([...(saved.camera ?? fresh.camera), 0, 0].slice(0, 6));
  return {
    ...fresh, ...saved, v: FORMAT_VERSION, joints, camera, shift: saved.shift ? [saved.shift[0], saved.shift[1]] : [0, 0],
    ring: saved.ring ?? null, hashira: saved.hashira ?? null,
    bamboo: saved.bamboo ? [...saved.bamboo.slice(0, 4), ...(saved.bamboo.length === 4 ? OLDER_BAMBOO : saved.bamboo.slice(4))] : null,
    shape: saved.shape ? cleanShape(saved.shape) : [...DEFAULT_SHAPE],
    ropes: saved.shape ? (saved.ropes ?? []).map((r) => ({ ...r, p: r.p.map((p) => /** @type {RopePoint} */ ([...p])) }))
      : ropesOntoBody(saved.ropes ?? []),
  };
}

/**
 * A pose with a new body shape (pose-skeleton.js's withShape also keeps it
 * on the floor).
 * @param {Pose} pose
 * @param {import("./figure-body.js").Shape} shape
 * @returns {Pose}
 */
export const setShape = (pose, shape) => ({ ...pose, shape: cleanShape(shape) });

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
  return { ...pose, joints: { ...pose.joints, [name]: clampJoint(name, angles, pose.joints[name], pose.joints) } };
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
 * The whole figure moved across or front to back (its ropes go with it;
 * a hardpoint stays where it is).
 * @param {Pose} pose
 * @param {number} index 0 across, 1 front to back
 * @param {number} cm
 * @returns {Pose}
 */
export function setShift(pose, index, cm) {
  const shift = /** @type {[number, number]} */ ([...pose.shift]);
  shift[index] = clamp(cm, SHIFT_RANGE[index]);
  return { ...pose, shift };
}

/**
 * The view, kept within its limits (yaw goes round and round).
 * @param {Pose} pose
 * @param {number[]} camera yaw, pitch, distance, target height, x and z
 * @returns {Pose}
 */
export function setCamera(pose, [yaw, pitch, distance, height, x = 0, z = 0]) {
  const wrapped = ((Math.round(yaw) % 360) + 540) % 360 - 180;
  return {
    ...pose,
    camera: [wrapped, clamp(pitch, CAMERA[1]), clamp(distance, CAMERA[2]), clamp(height, CAMERA[3]), clamp(x, CAMERA[4]), clamp(z, CAMERA[5])],
  };
}

/**
 * The view slid sideways and up or down, as two fingers dragging across
 * the screen move it: right and up are the screen's, seen from the camera.
 * @param {Pose} pose
 * @param {number} right cm to the right
 * @param {number} up cm up
 * @returns {Pose}
 */
export function panCamera(pose, right, up) {
  const [yaw, pitch, distance, height, x, z] = pose.camera;
  const turn = yaw * Math.PI / 180;
  return setCamera(pose, [yaw, pitch, distance, height + up, x + Math.cos(turn) * right, z - Math.sin(turn) * right]);
}

/** Which hardpoint a pose has, if any. @param {Pose} pose @returns {Hardpoint | null} */
export const hardpointOf = (pose) => HARDPOINTS.find((k) => pose[k] !== null) ?? null;

/**
 * Ropes with a hardpoint's points changed (or taken out, if `to` is null),
 * and any rope left too short taken out (with the cinches on it).
 * @param {Rope[]} ropes
 * @param {Hardpoint} from
 * @param {RopePoint | null} to
 */
function moveHardpointPoints(ropes, from, to) {
  return relink(ropes, ropes.map((r) => {
    if (isCinch(r)) return r;
    const p = r.p.flatMap((point) => (point[0] !== from ? [point] : to ? [/** @type {RopePoint} */ ([...to])] : []));
    return p.length >= 2 ? { ...r, p } : null;
  }));
}

/** Whether a point is on the ring or the bamboo (an upline's top). @param {RopePoint} point */
const onUplineHardpoint = (point) => point[0] === RING || point[0] === BAMBOO;

/** @param {Rope} rope @returns {boolean} whether it's a cinch */
export const isCinch = (rope) => rope.l !== undefined;

/** @param {Rope} rope @returns {boolean} whether it's a rope added to another (starting at a spot on it) */
export const isAdded = (rope) => !isCinch(rope) && rope.p[0]?.[0] === ROPE;

/**
 * Whether a rope's segment hangs from the ring or the bamboo (an upline's
 * hanging stretch, which a cinch pulls aside).
 * @param {Rope} rope
 * @param {number} segment between its points segment and segment + 1
 */
export const hangs = (rope, segment) => !isCinch(rope) && segment >= 0 && segment + 1 < rope.p.length &&
  onUplineHardpoint(rope.p[segment]) !== onUplineHardpoint(rope.p[segment + 1]);

/** Whether a rope goes to the ring or the bamboo. @param {Rope} rope */
export const isUpline = (rope) => !isCinch(rope) && rope.p.some(onUplineHardpoint);

/**
 * Whether a rope can be a see-saw: from the body over the ring or bamboo
 * and back to the body (on it once, not at either end).
 * @param {Rope} rope
 */
export function canSeesaw(rope) {
  if (isCinch(rope) || isAdded(rope)) return false;
  const tops = rope.p.flatMap((p, i) => (onUplineHardpoint(p) ? [i] : []));
  return tops.length === 1 && tops[0] > 0 && tops[0] < rope.p.length - 1;
}

/**
 * Whether a spot (a ["rope", …] point) is on a rope there that isn't a
 * cinch, on one of its segments.
 * @param {(Rope | null)[]} ropes
 * @param {RopePoint} spot
 */
const onRope = (ropes, [, i, segment]) => {
  const rope = ropes[i];
  return !!rope && !isCinch(rope) && segment >= 0 && segment + 1 < rope.p.length;
};

/**
 * Whether a cinch's points are where they can be: two or more, on ropes
 * there or the body (not a hardpoint), at least one on a hanging stretch.
 * @param {(Rope | null)[]} ropes
 * @param {Rope} cinch
 */
function cinchFits(ropes, cinch) {
  const on = cinch.p.filter((p) => p[0] === ROPE);
  if (cinch.p.length < 2 || on.length === 0) return false;
  if (cinch.p.some((p) => HARDPOINTS.includes(/** @type {Hardpoint} */ (p[0])))) return false;
  return on.every((p) => onRope(ropes, p)) && on.some(([, i, segment]) => hangs(/** @type {Rope} */ (ropes[i]), segment));
}

/**
 * Whether a rope added to another is on a rope there, before it, and has
 * no other spot on a rope.
 * @param {(Rope | null)[]} ropes
 * @param {Rope} rope
 * @param {number} index its own
 */
function addedFits(ropes, rope, index) {
  const [first, ...rest] = rope.p;
  return first[1] < index && onRope(ropes, first) && rest.every((p) => p[0] !== ROPE);
}

/**
 * Ropes after some are changed or taken out: `next[i]` is rope i as it is
 * now, or null if it's gone. A cinch goes with a rope it's on, or one
 * whose points changed in number (its segments have); the rest are
 * renumbered, and a rope that can't be a see-saw any more isn't one.
 * @param {Rope[]} ropes
 * @param {(Rope | null)[]} next
 * @returns {Rope[]}
 */
function relink(ropes, next) {
  // A cinch or added rope goes with what it's on, which can be one going
  // too: dropped until none more go.
  let kept = next;
  for (let changed = true; changed;) {
    const now = kept;
    kept = now.map((rope, i) => {
      if (!rope || !(isCinch(rope) || isAdded(rope))) return rope;
      const same = rope.p.every((p) => p[0] !== ROPE || now[p[1]]?.p.length === ropes[p[1]]?.p.length);
      return same && (isCinch(rope) ? cinchFits(now, rope) : addedFits(now, rope, i)) ? rope : null;
    });
    changed = kept.some((rope, i) => rope !== now[i]);
  }
  /** @type {number[]} */
  const index = [];
  let n = 0;
  for (const rope of kept) index.push(rope ? n++ : -1);
  return kept.flatMap((rope) => {
    if (!rope) return [];
    const renumbered = (/** @type {Rope} */ r) => ({ ...r, p: r.p.map((p) => /** @type {RopePoint} */ (p[0] === ROPE ? [ROPE, index[p[1]], p[2], p[3]] : p)) });
    if (isCinch(rope)) return [renumbered(rope)];
    if (isAdded(rope)) return [renumbered(rope)];
    if (rope.s && !canSeesaw(rope)) {
      const { s: _, ...plain } = rope;
      return [plain];
    }
    return [rope];
  });
}

/**
 * The rope points a pose would lose by changing its hardpoint to `next`:
 * all on the one it has, except between a ring and a bamboo, which both
 * hold uplines, so they move across.
 * @param {Pose} pose
 * @param {Hardpoint | null} next
 */
export function hardpointPointsLost(pose, next) {
  const now = hardpointOf(pose);
  if (!now || now === next || (next && now !== HASHIRA && next !== HASHIRA)) return 0;
  return pose.ropes.reduce((n, r) => n + r.p.filter((p) => p[0] === now).length, 0);
}

/**
 * The pose with this hardpoint (at its default place) in place of the one
 * it has, or with none (null). Between a ring and a bamboo, the uplines
 * move across: to the bamboo's middle, or to the ring. Otherwise the old
 * one's rope points go, and any rope left too short.
 * @param {Pose} pose
 * @param {Hardpoint | null} next
 * @param {number[]} [place] where the new one goes, if not DEFAULT_HARDPOINTS' place (kept within its limits)
 * @returns {Pose}
 */
export function setHardpoint(pose, next, place) {
  const now = hardpointOf(pose);
  if (now === next) return pose;
  let ropes = pose.ropes;
  if (now) {
    const upline = next && now !== HASHIRA && next !== HASHIRA;
    ropes = moveHardpointPoints(ropes, now, upline ? /** @type {RopePoint} */ ([next, 0, 0, 0]) : null);
  }
  /** @type {Pose} */
  const changed = { ...pose, ring: null, bamboo: null, hashira: null, ropes };
  if (next) {
    const ranges = HARDPOINT_RANGES[next];
    changed[next] = place ? place.map((n, i) => clamp(n, ranges[i])) : [...DEFAULT_HARDPOINTS[next]];
  }
  return changed;
}

/**
 * The hardpoint the pose has, moved (kept within its limits).
 * @param {Pose} pose
 * @param {number[]} place its numbers, as in the pose
 * @returns {Pose}
 */
export function moveHardpoint(pose, place) {
  const kind = hardpointOf(pose);
  if (!kind) return pose;
  const ranges = HARDPOINT_RANGES[kind];
  const moved = place.map((n, i) => clamp(n, ranges[i]));
  if (kind !== BAMBOO) return { ...pose, [kind]: moved };
  // The hangers stay on their own sides, and rope points slide in to stay
  // on a shorter bamboo.
  const length = moved[4];
  moved[5] = Math.min(moved[5], maxInset(length));
  const ropes = pose.ropes.map((r) => (r.p.some((p) => p[0] === BAMBOO && Math.abs(p[1]) > length * 5)
    ? { ...r, p: r.p.map((p) => (p[0] === BAMBOO ? bambooPoint(p[1], length) : p)) } : r));
  return { ...pose, bamboo: moved, ropes };
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
 * A point on the bamboo, mm along it from its middle (kept on it).
 * @param {number} along
 * @param {number} length the bamboo's, cm
 * @returns {RopePoint}
 */
export const bambooPoint = (along, length) => [BAMBOO, clamp(along, [-length * 5, length * 5]), 0, 0];

/**
 * A rope's point on the bamboo slid along it ("Move along bamboo"), kept
 * on it.
 * @param {Pose} pose
 * @param {number} index the rope's
 * @param {number} point which of its points (one on the bamboo)
 * @param {number} cm from the bamboo's middle
 * @returns {Pose}
 */
export function moveAlongBamboo(pose, index, point, cm) {
  const rope = pose.ropes[index];
  if (!pose.bamboo || rope?.p[point]?.[0] !== BAMBOO) return pose;
  const moved = bambooPoint(cm * 10, pose.bamboo[4]);
  return { ...pose, ropes: pose.ropes.map((r, i) => (i === index ? { ...r, p: r.p.map((p, j) => (j === point ? moved : p)) } : r)) };
}

/**
 * A spot on a rope, for a cinch: thousandths of the way along one of its
 * segments, kept off its ends.
 * @param {number} rope its index
 * @param {number} segment
 * @param {number} along 0 to 1
 * @returns {RopePoint}
 */
export const ropeSpot = (rope, segment, along) => [ROPE, rope, segment, clamp(along * 1000, [20, 980])];

/**
 * A point on the hashira, mm from the foot of the post in its own
 * directions (kept on it).
 * @param {[number, number, number]} mm
 * @returns {RopePoint}
 */
export const hashiraPoint = ([x, y, z]) => [HASHIRA, clamp(x, [-OFFSET, OFFSET]), clamp(y, [0, HASHIRA_SIZE.height * 10]), clamp(z, [-OFFSET, OFFSET])];

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
const samePoint = (a, b) => a[0] === b[0] && (a[0] === ROPE
  // A spot on a rope: the same rope and segment, and nearly as far along.
  ? a[1] === b[1] && a[2] === b[2] && Math.abs(a[3] - b[3]) < 5
  : Math.hypot(a[1] - b[1], a[2] - b[2], a[3] - b[3]) < 5);

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
 * isn't a rope). One over the ring or bamboo and back is a see-saw to
 * begin with.
 * @param {Pose} pose
 * @param {Rope} rope
 * @returns {Pose}
 */
export function finishRope(pose, rope) {
  if (rope.p.length < 2) return pose;
  return { ...pose, ropes: [...pose.ropes, canSeesaw(rope) ? { ...rope, s: true } : rope] };
}

/**
 * The pose without a rope, and the cinch on it if it has one.
 * @param {Pose} pose @param {number} index @returns {Pose}
 */
export const removeRope = (pose, index) => ({ ...pose, ropes: relink(pose.ropes, pose.ropes.map((r, i) => (i === index ? null : r))) });

/**
 * The cinches on a rope.
 * @param {Pose} pose
 * @param {number} index the rope's
 * @returns {number[]} the cinches' indexes
 */
export const cinchesOn = (pose, index) => pose.ropes.flatMap((r, i) => (isCinch(r) && r.p.some((p) => p[0] === ROPE && p[1] === index) ? [i] : []));

/**
 * Why a point can't be a cinch's next one (while it's being laid), or null if it can.
 * @param {Pose} pose
 * @param {RopePoint} point
 * @returns {string | null}
 */
export function cantCinchAt(pose, point) {
  if (HARDPOINTS.includes(/** @type {Hardpoint} */ (point[0]))) return `A cinch is tied to ropes and the body, not the ${point[0]}.`;
  if (point[0] !== ROPE) return null;
  const rope = pose.ropes[point[1]];
  if (!rope) return "That rope isn't there any more.";
  if (isCinch(rope)) return "A cinch can't go on another cinch.";
  return null;
}

/**
 * Why a cinch laid through these points can't be tied, or null if it can.
 * @param {Pose} pose
 * @param {RopePoint[]} points
 * @returns {string | null}
 */
export function cantCinch(pose, points) {
  if (pose.ropes.length >= MAX_ROPES) return `A pose can have at most ${MAX_ROPES} ropes.`;
  for (const point of points) {
    const problem = cantCinchAt(pose, point);
    if (problem) return problem;
  }
  if (points.length < 2) return "Tap another rope or the body to tie the cinch to, then Finish rope.";
  if (!cinchFits(pose.ropes, { c: "black", w: 1, p: points, l: 0 })) return "A cinch needs a point on an upline, between the ring or bamboo and the body.";
  return null;
}

/**
 * The pose with a cinch added through its points, as long as given (taut,
 * when it's the length of its line: pose-cinch.js).
 * @param {Pose} pose
 * @param {{ c: Color, w: Width }} look
 * @param {RopePoint[]} points
 * @param {number} length cm
 * @returns {Pose}
 */
export const addCinch = (pose, { c, w }, points, length) =>
  ({ ...pose, ropes: [...pose.ropes, { c, w, p: points.map((p) => /** @type {RopePoint} */ ([...p])), l: clamp(length, CINCH_RANGE) }] });

/**
 * Why a rope can't be added to this one, or null if it can.
 * @param {Pose} pose
 * @param {number} index the rope's
 * @returns {string | null}
 */
export function cantAddTo(pose, index) {
  const rope = pose.ropes[index];
  if (!rope) return "That rope isn't there any more.";
  if (isCinch(rope)) return "A rope can't be added to a cinch.";
  return cantAdd(pose, null);
}

/**
 * A rope's slack (its hanging stretches sag; drawn only).
 * @param {Pose} pose @param {number} index @param {number} cm @returns {Pose}
 */
export function setSlack(pose, index, cm) {
  return {
    ...pose, ropes: pose.ropes.map((r, i) => {
      if (i !== index || isCinch(r)) return r;
      const { k: _, ...plain } = r;
      const slack = clamp(Math.round(cm), SLACK_RANGE);
      return slack > 0 ? { ...plain, k: slack } : plain;
    }),
  };
}

/**
 * A cinch made longer or shorter.
 * @param {Pose} pose @param {number} index @param {number} length cm @returns {Pose}
 */
export const setCinchLength = (pose, index, length) =>
  ({ ...pose, ropes: pose.ropes.map((r, i) => (i === index ? { ...r, l: clamp(length, CINCH_RANGE) } : r)) });

/**
 * A rope made a see-saw, or not.
 * @param {Pose} pose @param {number} index @param {boolean} on @returns {Pose}
 */
export function setSeesaw(pose, index, on) {
  return {
    ...pose, ropes: pose.ropes.map((r, i) => {
      if (i !== index) return r;
      const { s: _, ...plain } = r;
      return on && canSeesaw(r) ? { ...plain, s: /** @type {true} */ (true) } : plain;
    }),
  };
}

/**
 * A preset's figure (figure-rig.js) on this pose: its ropes, hardpoint,
 * view and where it stands are kept.
 * @param {Pose} pose
 * @param {import("./figure-rig.js").Posture} posture
 * @returns {Pose}
 */
export const withPosture = (pose, { joints, body, lift }) => ({ ...pose, joints, body, lift });

/**
 * A pose as it's saved: without what's only the poser's (its pencil marks,
 * and whether a cinch moves the body).
 * @param {Pose} pose
 * @returns {Pose}
 */
export function forSaving(pose) {
  const { marks: _, ...saved } = pose;
  return {
    ...saved, ropes: pose.ropes.map((r) => {
      const { still: _still, ...rope } = r;
      return rope;
    }),
  };
}

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
