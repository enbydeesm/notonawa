// The poser's figure: a generic, genderless body as a tree of bones, each
// joint's movements with their limits, and the starting poses offered.
// Pure, so it's easy to test; pose-scene.js builds the 3D figure from it.
//
// Units are centimetres and whole degrees. The figure stands on the floor
// (y = 0) facing +z, so its left is +x. Every bone's axes start lined up
// with the world's, so a joint's angles say how far it's turned from
// standing with arms at the sides. Left and right are the figure's own.
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
 * A body part's shape: a capsule from a to b, or an ellipsoid at c.
 * @typedef {{ capsule: [number[], number[]], r: number } | { ellipsoid: number[], radii: number[] }} Shape
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
 * Each bone's shapes, in its own centimetres (from its joint). The pelvis
 * is the root; every other bone is named for the joint it turns at.
 * @type {Readonly<Record<string, Shape[]>>}
 */
export const SHAPES = Object.freeze({
  pelvis: [{ ellipsoid: [0, 0, 0], radii: [16, 11, 11] }],
  spine: [{ ellipsoid: [0, 8, 0], radii: [14, 12, 10] }],
  chest: [{ ellipsoid: [0, 12, 0.5], radii: [17, 14.5, 11] }],
  // The neck, the head, and a nose, so it's clear which way it faces.
  head: [{ capsule: [[0, -2, 0], [0, 8, 0]], r: 5 }, { ellipsoid: [0, 17, 1], radii: [9.5, 11.5, 10.5] }, { ellipsoid: [0, 16, 11], radii: [1.6, 2.4, 1.6] }],
  ...Object.fromEntries(["l", "r"].flatMap((side) => [
    [`${side}_shoulder`, [{ ellipsoid: [0, 0, 0], radii: [6.5, 6.5, 6.5] }, { capsule: [[0, 0, 0], [0, -29, 0]], r: 5 }]],
    [`${side}_elbow`, [{ capsule: [[0, 0, 0], [0, -25, 0]], r: 4 }]],
    // A flat hand, its palm toward the thigh.
    [`${side}_wrist`, [{ ellipsoid: [0, -8.5, 0], radii: [2.3, 9, 4.6] }]],
    [`${side}_hip`, [{ capsule: [[0, 0, 0], [0, -44, 0]], r: 7.5 }]],
    [`${side}_knee`, [{ capsule: [[0, 0, 0], [0, -43, 0]], r: 5.5 }]],
    [`${side}_ankle`, [{ ellipsoid: [0, -4, 5.5], radii: [4.5, 3.5, 12] }]],
  ])),
});

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
  { name: "On its side", body: /** @type {[number, number, number]} */ ([0, 0, 90]) },
  // Tipped right over and turned round, so it still faces the front.
  { name: "Upside down", body: /** @type {[number, number, number]} */ ([180, 180, 0]) },
]);

// Arms behind the back, forearms folded across each other (a box tie): the
// upper arms back enough that the forearms clear the back, one a little
// lower than the other.
const BOX_TIE = { l_shoulder: [-40, 10, -90], l_elbow: [100], r_shoulder: [-48, 10, -90], r_elbow: [110] };

/**
 * Starting poses: a name, and the joints that aren't at rest. Choosing one
 * keeps the ropes, ring and view.
 * @type {readonly { name: string, joints: Record<string, number[]>, body: [number, number, number], lift: number }[]}
 */
export const PRESETS = Object.freeze([
  { name: "Standing", joints: {}, body: [0, 0, 0], lift: STANDING_LIFT },
  { name: "Standing, box tie", joints: BOX_TIE, body: [0, 0, 0], lift: STANDING_LIFT },
  // The knees fold as far as they go (155°), so the thighs slope a little
  // and the shins lie flat on the floor.
  {
    name: "Kneeling, sitting back", body: [0, 0, 0], lift: 29,
    joints: { ...BOX_TIE, l_hip: [65, 8, 0], r_hip: [65, 8, 0], l_knee: [155], r_knee: [155], l_ankle: [-50], r_ankle: [-50] },
  },
  {
    name: "Kneeling up", body: [0, 0, 0], lift: 55,
    joints: { ...BOX_TIE, l_knee: [90], r_knee: [90], l_ankle: [-45], r_ankle: [-45] },
  },
  {
    name: "One leg folded (futomomo)", body: [0, 0, 0], lift: STANDING_LIFT,
    joints: { ...BOX_TIE, l_hip: [100, 15, 0], l_knee: [155], l_ankle: [-40] },
  },
  {
    name: "Face down", body: [90, 0, 0], lift: 110,
    joints: { ...BOX_TIE, head: [-30, 0, 0], l_hip: [5, 5, 0], r_hip: [40, 5, 0], l_knee: [20], r_knee: [80] },
  },
  {
    name: "Face up", body: [-90, 0, 0], lift: 110,
    joints: { ...BOX_TIE, head: [30, 0, 0], l_hip: [60, 10, 0], r_hip: [20, 10, 0], l_knee: [90], r_knee: [40] },
  },
  {
    name: "On its side", body: [0, 0, 90], lift: 110,
    joints: { ...BOX_TIE, spine: [10, 0, 0], l_hip: [90, 0, 0], l_knee: [140], r_hip: [20, 0, 0], r_knee: [30] },
  },
  {
    name: "Upside down", body: [180, 180, 0], lift: 165,
    joints: { ...BOX_TIE, l_hip: [10, 30, 0], r_hip: [10, 30, 0], l_knee: [15], r_knee: [15] },
  },
]);

/**
 * A preset's joints, every one listed (the rest at rest).
 * @param {typeof PRESETS[number]} preset
 * @returns {Posture}
 */
export function presetPosture(preset) {
  const joints = restJoints();
  for (const [name, angles] of Object.entries(preset.joints)) joints[name] = clampJoint(name, angles);
  return { joints, body: [...preset.body], lift: preset.lift };
}
