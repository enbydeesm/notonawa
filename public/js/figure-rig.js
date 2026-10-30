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
 * BONES), parents first; the last is the bone a rope point on that part is
 * kept on.
 * @typedef {readonly (readonly [string, number])[]} Drive
 */

/** How high the pelvis is when standing (cm). */
export const STANDING_LIFT = 99;

/** @param {string} label @param {Axis} axis @param {1 | -1} sign @param {number} min @param {number} max @returns {Move} */
const move = (label, axis, sign, min, max) => ({ label, axis, sign, min, max });

// The trunk and head bend forward, lean to the figure's left and turn its
// front to its left, when positive.
const trunk = (/** @type {[number, number][]} */ [bend, side, twist]) => [
  move("Forward", "x", 1, ...bend), move("Lean left", "z", -1, ...side), move("Turn left", "y", 1, ...twist),
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
      moves: [move("Forward", "x", -1, -70, 180), move("Out", "z", out, -30, 180), move("Twist out", "y", out, -90, 90)],
    },
    { name: `${side}_elbow`, label: `${name} elbow`, parent: `${side}_shoulder`, offset: [0, -29, 0], order: "XYZ",
      moves: [move("Bend", "x", -1, 0, 150)] },
    { name: `${side}_wrist`, label: `${name} wrist`, parent: `${side}_elbow`, offset: [0, -25, 0], order: "ZXY",
      moves: [move("Bend", "z", /** @type {1 | -1} */ (-s), -80, 80), move("Tilt", "x", 1, -30, 30)] },
    {
      name: `${side}_hip`, label: `${name} hip`, parent: "pelvis", offset: [9 * s, -5, 0], order: "ZXY",
      moves: [move("Forward", "x", -1, -30, 140), move("Out", "z", out, -30, 90), move("Twist out", "y", out, -50, 50)],
    },
    { name: `${side}_knee`, label: `${name} knee`, parent: `${side}_hip`, offset: [0, -44, 0], order: "XYZ",
      moves: [move("Bend", "x", 1, 0, 155)] },
    { name: `${side}_ankle`, label: `${name} ankle`, parent: `${side}_knee`, offset: [0, -43, 0], order: "XYZ",
      moves: [move("Toes up", "x", -1, -50, 30)] },
  ];
}

/** Every joint, parents before children. @type {readonly Joint[]} */
export const JOINTS = Object.freeze([
  { name: "spine", label: "Waist", parent: "pelvis", offset: [0, 8, 0], order: "XZY", moves: trunk([[-30, 60], [-35, 35], [-40, 40]]) },
  { name: "chest", label: "Chest", parent: "spine", offset: [0, 16, 0], order: "XZY", moves: trunk([[-25, 45], [-30, 30], [-40, 40]]) },
  { name: "head", label: "Head", parent: "chest", offset: [0, 26, 0], order: "XZY", moves: trunk([[-50, 70], [-45, 45], [-80, 80]]) },
  ...limbs("l").slice(0, 3), ...limbs("r").slice(0, 3),
  ...limbs("l").slice(3), ...limbs("r").slice(3),
]);

/** @type {ReadonlyMap<string, Joint>} */
const BY_NAME = new Map(JOINTS.map((j) => [j.name, j]));

/** @param {string} name */
export const jointNamed = (name) => BY_NAME.get(name);

/** What tapping each part selects, named for the person posing it. */
export const PART_LABELS = Object.freeze({ pelvis: "Hips and whole body", ...Object.fromEntries(JOINTS.map((j) => [j.name, j.label])) });

/**
 * Which body bones each joint turns, and how much of the turn each takes:
 * the waist, chest and neck bend over several vertebrae, so the back
 * curves rather than folding at one point. "pelvis" is the body's root.
 * @type {Readonly<Record<string, Drive>>}
 */
export const DRIVES = Object.freeze({
  pelvis: [["root", 1]],
  spine: [["spine04", 0.5], ["spine03", 0.5]],
  chest: [["spine02", 0.5], ["spine01", 0.5]],
  head: [["neck01", 0.3], ["neck02", 0.2], ["neck03", 0.2], ["head", 0.3]],
  ...Object.fromEntries(["L", "R"].flatMap((s) => {
    const side = s.toLowerCase();
    return [
      [`${side}_shoulder`, [[`upperarm01.${s}`, 1]]], [`${side}_elbow`, [[`lowerarm01.${s}`, 1]]], [`${side}_wrist`, [[`wrist.${s}`, 1]]],
      [`${side}_hip`, [[`upperleg01.${s}`, 1]]], [`${side}_knee`, [[`lowerleg01.${s}`, 1]]], [`${side}_ankle`, [[`foot.${s}`, 1]]],
    ];
  })),
});

/**
 * Body bones tapped as another part than the one that turns them: the low
 * belly and the small of the back (the lowest vertebra the waist bends)
 * are the hips', as on the first figure, so the hips are easy to tap.
 * @type {Readonly<Record<string, string>>}
 */
export const TAPPED_AS = Object.freeze({ spine04: "pelvis" });

/** The body bone a part's rope points are kept on. @param {string} part "pelvis" or a joint */
export const anchorBone = (part) => /** @type {Drive} */ (DRIVES[part]).at(-1)?.[0] ?? "root";

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
 * A joint's angles kept within its limits (whole degrees).
 * @param {string} name
 * @param {number[]} angles
 * @returns {number[]}
 */
export function clampJoint(name, angles) {
  const joint = BY_NAME.get(name);
  if (!joint) throw new Error(`No joint ${name}`);
  return joint.moves.map((m, i) => Math.min(m.max, Math.max(m.min, Math.round(angles[i] ?? 0))));
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
  { label: "Tip forward", min: -180, max: 180 }, { label: "Turn", min: -180, max: 180 }, { label: "Roll", min: -180, max: 180 },
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
 * @type {readonly BodyPreset[]}
 */
export const BODY_PRESETS = Object.freeze(/** @type {BodyPreset[]} */ ([
  { name: "Standing", joints: {}, body: [0, 0, 0], lift: STANDING_LIFT },
  // The knees fold as far as they go (155°), so the thighs slope a little
  // and the shins lie flat on the floor.
  {
    name: "Kneeling (seiza)", body: [0, 0, 0], lift: 19,
    joints: { l_hip: [68, 8, 0], r_hip: [68, 8, 0], l_knee: [155], r_knee: [155], l_ankle: [-50], r_ankle: [-50] },
  },
  { name: "Kneeling up", body: [0, 0, 0], lift: 50, joints: { l_knee: [90], r_knee: [90], l_ankle: [-45], r_ankle: [-45] } },
  { name: "One leg folded (futomomo)", body: [0, 0, 0], lift: STANDING_LIFT, joints: { l_hip: [100, 15, 0], l_knee: [155], l_ankle: [-40] } },
  {
    name: "Face down", body: [90, 0, 0], lift: 110,
    joints: { head: [-30, 0, 0], l_hip: [5, 5, 0], r_hip: [40, 5, 0], l_knee: [20], r_knee: [80] },
  },
  {
    name: "Face up", body: [-90, 0, 0], lift: 110,
    joints: { head: [30, 0, 0], l_hip: [60, 10, 0], r_hip: [20, 10, 0], l_knee: [90], r_knee: [40] },
  },
  {
    name: "On their side", body: [0, 0, 90], lift: 110,
    joints: { spine: [10, 0, 0], l_hip: [90, 0, 0], l_knee: [140], r_hip: [20, 0, 0], r_knee: [30] },
  },
  {
    name: "Upside down", body: [180, 180, 0], lift: 165,
    joints: { l_hip: [10, 30, 0], r_hip: [10, 30, 0], l_knee: [15], r_knee: [15] },
  },
]));

/**
 * Starting positions for the arms. Choosing one keeps the rest of the body.
 * @type {readonly ArmsPreset[]}
 */
export const ARMS_PRESETS = Object.freeze(/** @type {ArmsPreset[]} */ ([
  { name: "At sides", joints: {} },
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
      l_shoulder: [30, 3, -65], l_elbow: [133], l_wrist: [20, 0], r_shoulder: [30, 3, -65], r_elbow: [133], r_wrist: [20, 0],
    },
  },
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
    if (!ARM_JOINTS.includes(j.name)) joints[j.name] = clampJoint(j.name, preset.joints[j.name] ?? []);
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
  for (const name of ARM_JOINTS) joints[name] = clampJoint(name, preset.joints[name] ?? []);
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
