// The hips' angles from before they turned Forward first (pose format 1),
// as the hips have them now. Format 1's hip turned Out, then Forward, then
// twisted ("ZXY"); with the thigh forward, Out then barely moved the knee
// and swung the shin instead. Now it turns Forward, then Out, then twists
// ("XZY", figure-rig.js), so Out moves the knee sideways however far
// forward the leg is. Each older pose's and body preset's hips are turned
// into the angles that put the leg exactly where it was. Pure, with no
// imports.

/** The pose format whose hips turn Forward first. */
export const FORWARD_FIRST = 2;

const rad = (/** @type {number} */ d) => d * Math.PI / 180;
const deg = (/** @type {number} */ r) => r * 180 / Math.PI;

/** @typedef {[[number, number, number], [number, number, number], [number, number, number]]} Matrix */

/** @param {Matrix} a @param {Matrix} b @returns {Matrix} */
const times = (a, b) => /** @type {Matrix} */ (a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j])));
/** @param {number} a @returns {Matrix} */
const aboutX = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
/** @param {number} a @returns {Matrix} */
const aboutY = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
/** @param {number} a @returns {Matrix} */
const aboutZ = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];

/**
 * One hip's format 1 angles as the hip has them now, whole degrees (not
 * yet kept within the limits: readPose does that, as for any pose).
 * Slider to bone, as figure-rig.js has it: Forward is −x, Out and Twist
 * out are +z and +y on the left, −z and −y on the right.
 * @param {readonly number[]} angles [forward, out, twist out]
 * @param {"l" | "r"} side
 * @returns {number[]}
 */
export function newerHip(angles, side) {
  const [forward = 0, out = 0, twist = 0] = angles;
  const s = side === "l" ? 1 : -1;
  const x = rad(-forward), y = rad(s * twist), z = rad(s * out);
  // three.js's "ZXY": the bone turns by Rz · Rx · Ry.
  const m = times(times(aboutZ(z), aboutX(x)), aboutY(y));
  // Its "XZY" angles (Rx · Rz · Ry), as three.js's Euler.setFromRotationMatrix works them out.
  const nz = Math.asin(Math.max(-1, Math.min(1, -m[0][1])));
  const straight = Math.abs(m[0][1]) < 0.9999999;
  const nx = straight ? Math.atan2(m[2][1], m[1][1]) : Math.atan2(-m[1][2], m[2][2]);
  const ny = straight ? Math.atan2(m[0][2], m[0][0]) : 0;
  return [-deg(nx), s * deg(nz), s * deg(ny)].map((a) => Math.round(a) + 0);
}

/**
 * Something with joints (a pose or a body preset, as saved) with its hips
 * as they are now, if it's from before they turned Forward first: one
 * without `v`, or v 1 (`v` is then FORWARD_FIRST). Anything else is as it was.
 * @template {{ joints?: unknown, v?: unknown }} T
 * @param {T} data
 * @returns {T}
 */
export function withNewerHips(data) {
  if (!data || typeof data !== "object" || (data.v !== undefined && data.v !== 1)) return data;
  const sent = /** @type {Record<string, unknown>} */ (data.joints);
  if (!sent || typeof sent !== "object") return { ...data, v: FORWARD_FIRST };
  const joints = { ...sent };
  for (const side of /** @type {const} */ (["l", "r"])) {
    const angles = sent[`${side}_hip`];
    if (Array.isArray(angles) && angles.every((a) => typeof a === "number")) joints[`${side}_hip`] = newerHip(angles, side);
  }
  return { ...data, joints, v: FORWARD_FIRST };
}
