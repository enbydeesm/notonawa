// The poser's figure: the joints a pose turns, each joint's movements with
// their limits, which of the body's bones each one turns (DRIVES), and the
// starting poses offered. Pure, so it's easy to test. The body itself, a
// realistic one from Anny with its own skeleton, is figure-body.js's;
// pose-skeleton.js puts the joints' turns on its bones.
//
// Saved presets (the account's own, src/pose-presets/) are made here from
// the figure (bodyPresetFrom, armsPresetFrom) and put on it as the
// built-in ones are.
//
// Units are centimetres and whole degrees. The figure stands on the floor
// (y = 0) facing +z, so its left is +x. Every bone's axes start lined up
// with the world's, so a joint's angles say how far it's turned from
// standing with arms at the sides. Left and right are the figure's own.
//
// Each joint's `offset` is where it was on the first, simpler figure (from
// its parent's): only for moving older poses' ropes onto the body
// (pose-format.js, readPose).
//
// Each joint's movements are named for what they look like (Forward, Out,
// Twist…), positive the way the name says; `axis` and `sign` turn that into
// the rotation of the bone. src/poses/parse.js has the same limits (a unit
// test keeps them in step), so the server refuses an impossible pose.

import { withinReach } from "./joint-limits.js";

/** @typedef {"x" | "y" | "z"} Axis */
/** @typedef {{ label: string, axis: Axis, sign: 1 | -1, min: number, max: number }} Move */
/**
 * @typedef {{
 *   name: string, label: string, parent: string, offset: [number, number, number],
 *   order: "XYZ" | "XZY" | "YXZ" | "YZX" | "ZXY" | "ZYX", moves: Move[],
 * }} Joint
 */
/**
 * A joint's share of a turn for each body bone it turns (figure-body.js's
 * BONES), parents first: [bone, swing, twist]. The twist is the joint's
 * movement about the bone's length (its y, turned last), the swing the
 * rest; twist left out is the same share as the swing. Each part's shares
 * add up to the whole turn.
 * @typedef {readonly (readonly [string, number, number?])[]} Drive
 */

/** How high the pelvis is when standing (cm). */
export const STANDING_LIFT = 99;

/** @param {string} label @param {Axis} axis @param {1 | -1} sign @param {number} min @param {number} max @returns {Move} */
const move = (label, axis, sign, min, max) => ({ label, axis, sign, min, max });

// The trunk and head bend forward, lean to the figure's left and turn its
// front to its left, when positive.
const trunk = (/** @type {[number, number][]} */ [bend, side, twist]) => [
  move("Forward", "x", 1, ...bend), move("Lean", "z", -1, ...side), move("Turn", "y", 1, ...twist),
];

/**
 * An arm or a leg's joints, for one side.
 * @param {"l" | "r"} side
 * @returns {Joint[]}
 */
function limbs(side) {
  const s = side === "l" ? 1 : -1;
  const out = /** @type {1 | -1} */ (s);
  const name = side === "l" ? "Left" : "Right";
  return [
    {
      name: `${side}_shoulder`, label: `${name} shoulder`, parent: "chest", offset: [17 * s, 22, 0], order: "ZXY",
      moves: [move("Forward", "x", -1, -80, 180), move("Out", "z", out, -35, 180), move("Twist out", "y", out, -95, 95)],
    },
    // The forearm's twist turns the palm: out is palm forward (from facing
    // the thigh), in is palm back.
    { name: `${side}_elbow`, label: `${name} elbow`, parent: `${side}_shoulder`, offset: [0, -29, 0], order: "XYZ",
      moves: [move("Bend", "x", -1, -5, 155), move("Twist out", "y", out, -85, 95)] },
    { name: `${side}_wrist`, label: `${name} wrist`, parent: `${side}_elbow`, offset: [0, -25, 0], order: "ZXY",
      moves: [move("Bend", "z", /** @type {1 | -1} */ (-s), -85, 85), move("Tilt", "x", 1, -35, 35)] },
    // The hip turns Forward first, then Out, so Out moves the knee sideways
    // however far forward the leg is (pose format 1's turned Out first,
    // hip-order.js). It twists out further than in, as a hip does.
    {
      name: `${side}_hip`, label: `${name} hip`, parent: "pelvis", offset: [9 * s, -5, 0], order: "XZY",
      moves: [move("Forward", "x", -1, -35, 150), move("Out", "z", out, -35, 100), move("Twist out", "y", out, -50, 90)],
    },
    // The lower leg's twist turns the foot out or in: only once the knee
    // bends, and with the hip's no further than a leg can (joint-limits.js).
    { name: `${side}_knee`, label: `${name} knee`, parent: `${side}_hip`, offset: [0, -44, 0], order: "XYZ",
      moves: [move("Bend", "x", 1, -5, 160), move("Twist out", "y", out, -40, 40)] },
    // Pointed further than most (75°), for a "Barbie foot" with the toes up.
    { name: `${side}_ankle`, label: `${name} ankle`, parent: `${side}_knee`, offset: [0, -43, 0], order: "XYZ",
      moves: [move("Toes up", "x", -1, -75, 35)] },
    // The toes bend together at the ball of the foot: curled down, or up.
    { name: `${side}_toes`, label: `${name} toes`, parent: `${side}_ankle`, offset: [0, -7, 13], order: "XYZ",
      moves: [move("Up", "x", -1, -35, 85)] },
  ];
}

/** Every joint, parents before children. @type {readonly Joint[]} */
export const JOINTS = Object.freeze([
  // The pelvis tipped forward or back, one side hiked up, or turned, about
  // the point between the hip joints (its sliders keep the legs and the
  // trunk where they were, the lower back bending: pose-skeleton.js's
  // withHips).
  {
    name: "hips", label: "Hips", parent: "pelvis", offset: [0, 0, 0], order: "XZY",
    moves: [move("Tilt", "x", 1, -35, 35), move("Hike", "z", 1, -25, 25), move("Turn", "y", 1, -35, 35)],
  },
  // The ranges are a little further than most people's (about halfway
  // between a typical body and a very flexible one: a very flexible one
  // allowed horrific poses), and the elbows and knees go 5° past straight.
  { name: "spine", label: "Waist", parent: "pelvis", offset: [0, 8, 0], order: "XZY", moves: trunk([[-55, 70], [-40, 40], [-40, 40]]) },
  { name: "chest", label: "Chest", parent: "spine", offset: [0, 16, 0], order: "XZY", moves: trunk([[-45, 50], [-35, 35], [-40, 40]]) },
  { name: "head", label: "Head", parent: "chest", offset: [0, 26, 0], order: "XZY", moves: trunk([[-55, 75], [-50, 50], [-85, 85]]) },
  ...limbs("l").slice(0, 3), ...limbs("r").slice(0, 3),
  ...limbs("l").slice(3), ...limbs("r").slice(3),
]);

/** @type {ReadonlyMap<string, Joint>} */
const BY_NAME = new Map(JOINTS.map((j) => [j.name, j]));

/** @param {string} name */
export const jointNamed = (name) => BY_NAME.get(name);

/** What tapping each part selects, named for the person posing it. */
export const PART_LABELS = Object.freeze({ pelvis: "Hips", ...Object.fromEntries(JOINTS.map((j) => [j.name, j.label])) });

/**
 * Which body bones each joint turns, and how much of the turn each takes:
 * the waist, chest and neck bend over several vertebrae, so the back
 * curves rather than folding at one point. A shoulder's raise is shared
 * with the collarbone and shoulder blade, so the shoulder rises with the
 * arm; an upper arm's, forearm's, thigh's or shin's twist is spread over
 * its two bones, so
 * the skin twists along it rather than pinching at the joint. "pelvis" is
 * the body's root.
 * @type {Readonly<Record<string, Drive>>}
 */
export const DRIVES = Object.freeze({
  pelvis: [["root", 1]],
  // The pelvis turns the root itself (pose-skeleton.js), not a bone of its own.
  hips: [],
  spine: [["spine05", 0.34], ["spine04", 0.33], ["spine03", 0.33]],
  chest: [["spine02", 0.5], ["spine01", 0.5]],
  head: [["neck01", 0.3], ["neck02", 0.2], ["neck03", 0.2], ["head", 0.3]],
  ...Object.fromEntries(["L", "R"].flatMap((s) => {
    const side = s.toLowerCase();
    return [
      [`${side}_shoulder`, [[`clavicle.${s}`, 0.12, 0], [`shoulder01.${s}`, 0.08, 0], [`upperarm01.${s}`, 0.8, 0.5], [`upperarm02.${s}`, 0, 0.5]]],
      [`${side}_elbow`, [[`lowerarm01.${s}`, 1, 0.4], [`lowerarm02.${s}`, 0, 0.6]]], [`${side}_wrist`, [[`wrist.${s}`, 1]]],
      [`${side}_hip`, [[`upperleg01.${s}`, 1, 0.5], [`upperleg02.${s}`, 0, 0.5]]],
      [`${side}_knee`, [[`lowerleg01.${s}`, 1, 0.5], [`lowerleg02.${s}`, 0, 0.5]]], [`${side}_ankle`, [[`foot.${s}`, 1]]],
      // The first bone of each toe, at the ball of the foot (the second toe's last: its rope points' anchor).
      [`${side}_toes`, ["1", "3", "4", "5", "2"].map((t) => /** @type {[string, number]} */ ([`toe${t}-1.${s}`, 1]))],
    ];
  })),
});

/**
 * Body bones tapped as another part than the one that turns them: the low
 * belly and the small of the back (the lowest vertebra the waist bends)
 * are the hips', as on the first figure, so the hips are easy to tap; the
 * collarbones (which a raised arm lifts) are the chest's.
 * @type {Readonly<Record<string, string>>}
 */
export const TAPPED_AS = Object.freeze({ "spine05": "pelvis", "spine04": "pelvis", "clavicle.L": "chest", "clavicle.R": "chest" });

/**
 * Body bones tapped (to pose) as another part than their rope points are
 * on: the hips pose the pelvis (the Hips joint); the top of their area is
 * the waist's (pose-skeleton.js's vertexParts), so the waist is easy to tap.
 * @type {Readonly<Record<string, string>>}
 */
export const POSED_AS = Object.freeze({
  ...TAPPED_AS, "root": "hips", "pelvis.L": "hips", "pelvis.R": "hips", "spine05": "hips", "spine04": "hips",
});

/** How much of the hips' area, from its top, poses the waist instead. */
export const WAIST_SHARE_OF_HIPS = 0.3;

/**
 * The body bone at a part's joint: its rope points are measured from that
 * bone's joint, turned with the whole of the part's turn (the last bone
 * the part turns carries them, pose-skeleton.js). It's the last bone that
 * swings.
 * @param {string} part "pelvis" or a joint
 */
export const anchorBone = (part) => /** @type {Drive} */ (DRIVES[part]).findLast(([, swing]) => swing > 0)?.[0] ?? "root";

/** The last bone a part turns, which carries its rope points. @param {string} part */
export const carrierBone = (part) => /** @type {Drive} */ (DRIVES[part]).at(-1)?.[0] ?? "root";

/**
 * Where each part's joint was on the first figure, standing (cm from the
 * pelvis): its offsets added up.
 * @returns {Record<string, [number, number, number]>}
 */
export function olderJointPlaces() {
  /** @type {Record<string, [number, number, number]>} */
  const at = { pelvis: [0, 0, 0] };
  for (const j of JOINTS) {
    const [x, y, z] = at[j.parent];
    at[j.name] = [x + j.offset[0], y + j.offset[1], z + j.offset[2]];
  }
  return at;
}

/**
 * @typedef {{
 *   joints: Record<string, number[]>, body: [number, number, number], lift: number,
 * }} Posture the figure's part of a pose (pose-format.js has the rest)
 */

/** @returns {Record<string, number[]>} every joint at rest */
export const restJoints = () => Object.fromEntries(JOINTS.map((j) => [j.name, j.moves.map(() => 0)]));

/**
 * How a new pose starts, and what Reset puts a joint back to: at rest, but
 * the arms a little out, so the hands start clear of the thighs.
 * @type {Readonly<Record<string, readonly number[]>>}
 */
export const START_JOINTS = Object.freeze({ l_shoulder: [0, 4, 0], r_shoulder: [0, 4, 0] });

/** @returns {Record<string, number[]>} every joint as a new pose has it */
export const startJoints = () => ({ ...restJoints(), ...Object.fromEntries(Object.entries(START_JOINTS).map(([n, a]) => [n, [...a]])) });

/**
 * A joint's angles kept within its limits (whole degrees): each
 * movement's own range, then (unless reach is false) the shoulders' and
 * hips' limits that depend on several (joint-limits.js), stopping where
 * it last could on the way from `from`.
 * @param {string} name
 * @param {readonly number[]} angles
 * @param {readonly number[]} [from] what the joint was (rest if left out)
 * @param {Readonly<Record<string, readonly number[]>>} [joints] the rest of the pose (a knee's twist and its hip's depend on each other)
 * @param {boolean} [reach] keep to the limits that depend on several movements (false: only each one's own range)
 * @returns {number[]}
 */
export function clampJoint(name, angles, from, joints, reach = true) {
  const joint = BY_NAME.get(name);
  if (!joint) throw new Error(`No joint ${name}`);
  // A movement left out (an older pose's elbow or knee, from before they
  // twisted) is at rest.
  const each = joint.moves.map((m, i) => Math.min(m.max, Math.max(m.min, Math.round(angles[i] ?? 0))));
  return reach ? withinReach(name, each, from, joints) : each;
}

/**
 * Something with joints (a pose or a preset, as saved) with any joint
 * past a movement's range brought within it, the rest left exactly as
 * they were: for one saved or exported before the limits changed. The
 * limits that depend on several movements are left to the poser, as the
 * server doesn't check them.
 * @template {{ joints?: unknown }} T
 * @param {T} data
 * @returns {T}
 */
export function jointsInRange(data) {
  const sent = /** @type {Record<string, unknown>} */ (data.joints);
  if (!sent || typeof sent !== "object") return data;
  /** @type {Record<string, unknown>} */
  const joints = { ...sent };
  for (const [name, angles] of Object.entries(sent)) {
    if (!BY_NAME.has(name) || !Array.isArray(angles)) continue;
    const clamped = clampJoint(name, angles, undefined, /** @type {Record<string, number[]>} */ (joints), false);
    if (clamped.length !== angles.length || clamped.some((a, i) => a !== angles[i])) joints[name] = clamped;
  }
  return { ...data, joints };
}

/**
 * The rotation a joint's angles give its bone, in radians, for three.js.
 * @param {string} name
 * @param {number[]} angles
 * @returns {{ x: number, y: number, z: number, order: Joint["order"] }}
 */
export function jointRotation(name, angles) {
  const joint = BY_NAME.get(name);
  if (!joint) throw new Error(`No joint ${name}`);
  const rotation = { x: 0, y: 0, z: 0, order: joint.order };
  joint.moves.forEach((m, i) => { rotation[m.axis] += m.sign * (angles[i] ?? 0) * Math.PI / 180; });
  return rotation;
}

/**
 * The whole body's turn (pitch, yaw, roll) as a rotation of the figure
 * about its pelvis: tipped forward, turned, then rolled onto its side.
 * @param {[number, number, number]} body
 */
export const bodyRotation = ([pitch, yaw, roll]) =>
  ({ x: pitch * Math.PI / 180, y: yaw * Math.PI / 180, z: roll * Math.PI / 180, order: /** @type {const} */ ("YXZ") });

/** The body's own movements, shown when the hips are selected. */
export const BODY_MOVES = Object.freeze([
  { label: "Tip body", min: -180, max: 180 }, { label: "Turn body", min: -180, max: 180 }, { label: "Roll body", min: -180, max: 180 },
]);
export const LIFT_RANGE = /** @type {const} */ ([0, 250]);

/** The ways the whole body can be put quickly: [pitch, yaw, roll]. */
export const ORIENTATIONS = Object.freeze([
  { name: "Upright", body: /** @type {[number, number, number]} */ ([0, 0, 0]) },
  { name: "Face down", body: /** @type {[number, number, number]} */ ([90, 0, 0]) },
  { name: "Face up", body: /** @type {[number, number, number]} */ ([-90, 0, 0]) },
  { name: "On their side", body: /** @type {[number, number, number]} */ ([0, 0, 90]) },
  // Tipped right over and turned round, so it still faces the front.
  { name: "Upside down", body: /** @type {[number, number, number]} */ ([180, 180, 0]) },
]);

/** The arms' joints, which the arms presets set and the body presets leave alone. */
export const ARM_JOINTS = Object.freeze(["l_shoulder", "l_elbow", "l_wrist", "r_shoulder", "r_elbow", "r_wrist"]);

/** @typedef {{ name: string, joints: Record<string, number[]>, body: [number, number, number], lift: number }} BodyPreset */
/** @typedef {{ name: string, joints: Record<string, number[]> }} ArmsPreset */

/**
 * Starting positions for the body: everything but the arms (the trunk,
 * head and legs, and the whole body's turn and height), as the joints that
 * aren't at rest. Choosing one keeps the arms, ropes, hardpoint and view.
 * Each rests on the floor (its lift puts the skin's lowest point there),
 * but face down, face up, on their side and upside down, which start in
 * the air. Kneeling (seiza), One leg folded, Face down, Face up, On their
 * side and Upside down were worked out for format 1's hips, which turned
 * Out first: hip-order.js turned their hips into these, so each looks as
 * it did.
 * @type {readonly BodyPreset[]}
 */
export const BODY_PRESETS = Object.freeze(/** @type {BodyPreset[]} */ ([
  { name: "Standing", joints: {}, body: [0, 0, 0], lift: STANDING_LIFT },
  // Standing on one leg, the other raised out to the side, knee bent.
  // Standing on one leg, the other raised out to the side, the knee as high
  // as the waist and the shin hanging in line with the thigh.
  { name: "Kata ashi (right leg up)", body: [0, 0, 0], lift: STANDING_LIFT, joints: { r_hip: [115, 49, -18], r_knee: [68, 13], r_ankle: [-30] } },
  { name: "Kata ashi (left leg up)", body: [0, 0, 0], lift: STANDING_LIFT, joints: { l_hip: [115, 49, -18], l_knee: [68, 13], l_ankle: [-30] } },
  // Leaning forward over bent knees, the knees and ankles touching.
  {
    name: "Chair pose", body: [40, 0, 0], lift: 75,
    joints: { head: [-25, 0, 0], l_hip: [95, -13, 4], r_hip: [95, -13, 4], l_knee: [80, 5], r_knee: [80, 5], l_ankle: [10], r_ankle: [10] },
  },
  {
    name: "Deep squat", body: [0, 0, 0], lift: 28,
    joints: { spine: [30, 0, 0], l_hip: [110, 15, -5], r_hip: [110, 15, -5], l_knee: [140], r_knee: [140], l_ankle: [32], r_ankle: [32] },
  },
  // The knees fold as far as they go (155°), so the thighs slope a little
  // and the shins lie flat on the floor.
  {
    name: "Kneeling (seiza)", body: [0, 0, 0], lift: 19,
    joints: { l_hip: [68, 3, -7], r_hip: [68, 3, -7], l_knee: [155], r_knee: [155], l_ankle: [-50], r_ankle: [-50] },
  },
  { name: "Kneeling up", body: [0, 0, 0], lift: 50, joints: { l_knee: [90], r_knee: [90], l_ankle: [-45], r_ankle: [-45] } },
  // Sitting on the floor.
  // Leaning back a little, the legs open and the knees up, each shin in
  // line with its thigh, the feet planted on the floor.
  {
    name: "Seated, legs open", body: [-10, 0, 0], lift: 26,
    joints: { head: [10, 0, 0], l_hip: [100, 35, -10], r_hip: [100, 35, -10], l_knee: [60, -10], r_knee: [60, -10], l_ankle: [-40], r_ankle: [-40] },
  },
  // Leaning back, knees up, the knees and ankles touching, the bottom and feet on the floor.
  {
    name: "Seated, legs together", body: [-20, 0, 0], lift: 24,
    joints: { head: [20, 0, 0], l_hip: [90, -12, 4], r_hip: [90, -12, 4], l_knee: [65, 0], r_knee: [65, 0], l_ankle: [-40], r_ankle: [-40] },
  },
  {
    name: "Sitting, crossed legs", body: [0, 0, 0], lift: 26,
    joints: { l_hip: [77, 41, 87], l_knee: [131, 2], l_ankle: [-30], r_hip: [72, 44, 85], r_knee: [135, 0], r_ankle: [-30] },
  },
  // Both knees folded, the feet to one side of the hips.
  {
    name: "Side-saddle (feet to the right)", body: [0, 0, 0], lift: 29,
    joints: { chest: [0, 8, 0], l_hip: [77, 7, 77], l_knee: [125, 31], l_ankle: [-50], r_hip: [68, 7, -45], r_knee: [137, -24], r_ankle: [-50] },
  },
  {
    name: "Side-saddle (feet to the left)", body: [0, 0, 0], lift: 29,
    joints: { chest: [0, -8, 0], r_hip: [77, 7, 77], r_knee: [125, 31], r_ankle: [-50], l_hip: [68, 7, -45], l_knee: [137, -24], l_ankle: [-50] },
  },
  // Each leg folded heel to hip, the knees open.
  {
    name: "Frogtie, seated", body: [0, 0, 0], lift: 27,
    joints: { spine: [-5, 0, 0], l_hip: [60, 45, 30], r_hip: [60, 45, 30], l_knee: [155], r_knee: [155], l_ankle: [-40], r_ankle: [-40] },
  },
  // Crossed legs, folded forward, the head toward the feet.
  {
    name: "Ebi (shrimp)", body: [0, 0, 0], lift: 26,
    joints: {
      spine: [60, 0, 0], chest: [45, 0, 0], head: [25, 0, 0],
      l_hip: [77, 41, 87], l_knee: [131, 2], l_ankle: [-30], r_hip: [72, 44, 85], r_knee: [135, 0], r_ankle: [-30],
    },
  },
  { name: "One leg folded (futomomo)", body: [0, 0, 0], lift: STANDING_LIFT, joints: { l_hip: [100, -3, -15], l_knee: [155], l_ankle: [-40] } },
  // On hands and knees, the thighs straight down; the arms preset of the same name puts the hands on the floor.
  {
    name: "All fours", body: [80, 0, 0], lift: 51,
    joints: { head: [-30, 0, 0], l_hip: [80, 3, 0], r_hip: [80, 3, 0], l_knee: [90], r_knee: [90], l_ankle: [-45], r_ankle: [-45] },
  },
  // On elbows and knees, both legs folded (futomomo); the arms preset of the same name puts the elbows on the floor.
  {
    name: "All fours, elbows", body: [107, 0, 0], lift: 50,
    joints: { head: [-40, 0, 0], l_hip: [107, 5, 0], r_hip: [107, 5, 0], l_knee: [155], r_knee: [155], l_ankle: [-40], r_ankle: [-40] },
  },
  {
    name: "Face down", body: [90, 0, 0], lift: 110,
    joints: { head: [-30, 0, 0], l_hip: [5, 5, 0], r_hip: [40, 4, -3], l_knee: [20], r_knee: [80] },
  },
  // Face down on the floor, knees bent, the feet raised toward the hands, the head up.
  {
    name: "Hogtie", body: [90, 0, 0], lift: 14,
    joints: { head: [-35, 0, 0], spine: [-15, 0, 0], l_hip: [-10, 5, 0], r_hip: [-10, 5, 0], l_knee: [125], r_knee: [125], l_ankle: [-45], r_ankle: [-45] },
  },
  {
    name: "Face up", body: [-90, 0, 0], lift: 110,
    joints: { head: [30, 0, 0], l_hip: [60, 5, -9], r_hip: [20, 9, -3], l_knee: [90], r_knee: [40] },
  },
  {
    name: "On their side", body: [0, 0, 90], lift: 110,
    joints: { spine: [10, 0, 0], l_hip: [90, 0, 0], l_knee: [140], r_hip: [20, 0, 0], r_knee: [30] },
  },
  // As a side suspension starts: the top leg folded (futomomo), the other nearly straight.
  {
    name: "On their side, top leg folded (left)", body: [0, 0, 90], lift: 110,
    joints: { spine: [10, 0, 0], l_hip: [75, 0, 0], l_knee: [155], l_ankle: [-40], r_hip: [10, 0, 0], r_knee: [20] },
  },
  {
    name: "On their side, top leg folded (right)", body: [0, 0, -90], lift: 110,
    joints: { spine: [10, 0, 0], r_hip: [75, 0, 0], r_knee: [155], r_ankle: [-40], l_hip: [10, 0, 0], l_knee: [20] },
  },
  {
    name: "Upside down", body: [180, 180, 0], lift: 165,
    // The legs folded: knees bent right up, toes pointed.
    joints: { l_hip: [19, 5, -2], r_hip: [19, 5, -2], l_knee: [150], r_knee: [150], l_ankle: [-50], r_ankle: [-50] },
  },
]));

/**
 * Starting positions for the arms. Choosing one keeps the rest of the body.
 * @type {readonly ArmsPreset[]}
 */
export const ARMS_PRESETS = Object.freeze(/** @type {ArmsPreset[]} */ ([
  { name: "At sides", joints: { ...START_JOINTS } },
  // The upper arms back enough that the forearms clear the back, folded
  // across each other, one a little lower than the other.
  { name: "Boxtie", joints: { l_shoulder: [-21, 5, -90], l_elbow: [105], r_shoulder: [-21, 5, -90], r_elbow: [90] } },
  // Elbows up past the head, hands meeting behind the neck.
  { name: "Bunny ears", joints: { l_shoulder: [180, 2, -50], l_elbow: [142], r_shoulder: [180, 2, -50], r_elbow: [142] } },
  // Elbows down by the sides, the forearms folded up and out, hands at the
  // shoulders' height.
  {
    name: "Tengu", joints: {
      l_shoulder: [0, 5, 87], l_elbow: [150], l_wrist: [-10, -20], r_shoulder: [0, 5, 87], r_elbow: [150], r_wrist: [-10, -20],
    },
  },
  // The elbows back, the forearms folded forward beside the chest.
  { name: "Tenshi", joints: { l_shoulder: [-48, 5, -2], l_elbow: [150], r_shoulder: [-48, 5, -2], r_elbow: [150] } },
  // The forearms across the front of the chest, the hands crossing, as in a hug.
  {
    name: "Crossed (hug)", joints: {
      l_shoulder: [30, 3, -65], l_elbow: [133], l_wrist: [13, 14], r_shoulder: [30, 3, -65], r_elbow: [133], r_wrist: [9, 11],
    },
  },
  // For the body presets of the same names: straight down to the floor
  // with the trunk at "All fours"'s slope, the palms flat on it, fingers
  // forward; and the upper arms straight down with the elbows bent as
  // Tenshi's, the elbows on the floor.
  {
    name: "All fours", joints: {
      l_shoulder: [80, 5, 0], l_elbow: [0, -85], l_wrist: [-80, 0], r_shoulder: [80, 5, 0], r_elbow: [0, -85], r_wrist: [-80, 0],
    },
  },
  { name: "All fours, elbows", joints: { l_shoulder: [107, 8, 0], l_elbow: [150, 0], r_shoulder: [107, 8, 0], r_elbow: [150, 0] } },
]));

/**
 * A body preset on a figure: its trunk, head and legs, and the body's turn
 * and height, with the arms left as they were.
 * @param {Posture} posture the figure now
 * @param {BodyPreset} preset
 * @returns {Posture}
 */
export function withBodyPreset(posture, preset) {
  const joints = { ...posture.joints };
  for (const j of JOINTS) {
    if (!ARM_JOINTS.includes(j.name)) joints[j.name] = clampJoint(j.name, preset.joints[j.name] ?? [], undefined, joints);
  }
  return { joints, body: [...preset.body], lift: preset.lift };
}

/**
 * An arms preset on a figure, with the rest of the body left as it was.
 * @param {Posture} posture
 * @param {ArmsPreset} preset
 * @returns {Posture}
 */
export function withArmsPreset(posture, preset) {
  const joints = { ...posture.joints };
  for (const name of ARM_JOINTS) joints[name] = clampJoint(name, preset.joints[name] ?? [], undefined, joints);
  return { ...posture, joints };
}

/** Presets one account can save, body and arms together (src/pose-presets/parse.js has the same; a unit test keeps them in step). */
export const MAX_PRESETS = 50;

/**
 * The body preset a figure is in: everything but the arms, to save and
 * start other poses from (withBodyPreset puts it back).
 * @param {Posture} posture
 * @param {string} name
 * @returns {BodyPreset}
 */
export function bodyPresetFrom(posture, name) {
  const joints = Object.fromEntries(JOINTS.filter((j) => !ARM_JOINTS.includes(j.name)).map((j) => [j.name, [...posture.joints[j.name]]]));
  return { name, joints, body: [...posture.body], lift: posture.lift };
}

/**
 * The arms preset a figure is in: the shoulders, elbows and wrists.
 * @param {Posture} posture
 * @param {string} name
 * @returns {ArmsPreset}
 */
export function armsPresetFrom(posture, name) {
  return { name, joints: Object.fromEntries(ARM_JOINTS.map((n) => [n, [...posture.joints[n]]])) };
}

/** @param {unknown} a @param {unknown} b @returns {boolean} whether two lists of angles (nested) are the same, to a twentieth of a degree */
const sameAngles = (a, b) => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.05;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameAngles(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => sameAngles(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k]));
  }
  return a === b;
};

/**
 * Whether a figure is in a body or arms preset already: choosing it would
 * change nothing (a built-in one's missing joints count as at rest, and
 * its angles as kept within reach, as choosing it would).
 * @param {"body" | "arms"} kind
 * @param {Posture} posture
 * @param {Omit<BodyPreset, "name"> | Omit<ArmsPreset, "name">} preset
 * @param {{ liftWithin?: number }} [options] how close the heights must be (cm): a body's
 *   height worked out for another body shape is only as close as half a centimetre
 * @returns {boolean}
 */
export function inPreset(kind, posture, preset, { liftWithin = 0.05 } = {}) {
  const named = /** @type {any} */ ({ name: "", ...preset });
  if (kind === "body") {
    const { lift: now, ...rest } = bodyPresetFrom(posture, "");
    const { lift: then, ...after } = bodyPresetFrom(withBodyPreset(posture, named), "");
    return Math.abs(now - then) <= liftWithin && sameAngles(rest, after);
  }
  return sameAngles(armsPresetFrom(posture, ""), armsPresetFrom(withArmsPreset(posture, named), ""));
}
