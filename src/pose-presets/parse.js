// Saved poser presets: their format, limits and request parsing. Pure, so
// it's easy to test.
//
// A preset is a body or arms position someone saved in the poser, to start
// any pose from. Its name is sealed in the browser; its angles are plain
// JSON, as a pose's are, checked against the same joint limits:
//   body: { joints: { spine: [bend, side, twist], l_hip: […], … },
//           body: [pitch, yaw, roll], lift }
//         every joint but the arms' (a joint left out is at rest)
//   arms: { joints: { l_shoulder: […], l_elbow: […], … } }
//         only the arms' joints
// The page's figure-rig.js makes and applies them (bodyPresetFrom,
// armsPresetFrom, withBodyPreset, withArmsPreset).

import { BadInput } from "../http.js";
import { encryptedText } from "../parse.js";
import { JOINTS, BODY_ANGLE, LIFT, padded } from "../poses/parse.js";

export const KINDS = /** @type {const} */ (["body", "arms"]);
/** The arms' joints: an arms preset has only these, and a body preset none of them. */
export const ARM_JOINTS = Object.freeze(["l_shoulder", "l_elbow", "l_wrist", "r_shoulder", "r_elbow", "r_wrist"]);
/** Presets one account can keep, body and arms together. */
export const MAX_PRESETS = 50;
/** A sealed name (a name is short; sealing adds a third and more). */
export const MAX_SEALED_NAME = 1000;

/**
 * @typedef {"body" | "arms"} Kind
 * @typedef {{ joints: Record<string, number[]>, body?: [number, number, number], lift?: number }} PresetData
 */

// Made by the server with crypto.randomUUID().
const PRESET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function parsePresetId(value) {
  if (typeof value !== "string" || !PRESET_ID.test(value)) throw new BadInput("That isn't a preset id.");
  return value;
}

/**
 * @param {unknown} value
 * @returns {Kind}
 */
export function parseKind(value) {
  if (!KINDS.includes(/** @type {Kind} */ (value))) throw new BadInput("A preset is for the body or the arms.");
  return /** @type {Kind} */ (value);
}

/**
 * A name, sealed in the browser; required.
 * @param {unknown} value
 * @returns {string}
 */
export function parseName(value) {
  let name;
  try {
    name = encryptedText(value);
  } catch {
    throw new BadInput("Couldn't save the preset's name: it wasn't encrypted. Reload the page and try again.");
  }
  if (name === null) throw new BadInput("A preset needs a name.");
  if (name.length > MAX_SEALED_NAME) throw new BadInput("That name is too long.");
  return name;
}

/**
 * Whether value is a whole number from min to max.
 * @param {unknown} value @param {number} min @param {number} max
 */
const within = (value, min, max) => Number.isInteger(value) && /** @type {number} */ (value) >= min && /** @type {number} */ (value) <= max;

/**
 * A preset's angles as sent, checked and rebuilt with only what its kind
 * has (so nothing else sent along is stored).
 * @param {Kind} kind
 * @param {unknown} value
 * @returns {PresetData}
 */
export function parsePresetData(kind, value) {
  const bad = (/** @type {string} */ why) => new BadInput(`Couldn't save the preset: ${why}`);
  const doc = /** @type {Record<string, any>} */ (value);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw bad("it was missing.");
  const sent = doc.joints;
  if (!sent || typeof sent !== "object" || Array.isArray(sent)) throw bad("it has no joints.");
  const names = Object.keys(JOINTS).filter((name) => ARM_JOINTS.includes(name) === (kind === "arms"));
  for (const name of Object.keys(sent)) {
    if (!names.includes(name)) throw bad(`it has a joint a${kind === "arms" ? "n arms" : " body"} preset doesn't.`);
  }
  /** @type {Record<string, number[]>} */
  const joints = {};
  for (const name of names) {
    const ranges = JOINTS[name];
    const angles = padded(Object.hasOwn(sent, name) ? sent[name] : [], ranges);
    if (!Array.isArray(angles) || angles.length !== ranges.length || !angles.every((n, i) => within(n, ranges[i][0], ranges[i][1]))) {
      throw bad("a joint is bent further than a body can.");
    }
    joints[name] = [...angles];
  }
  if (kind === "arms") return { joints };
  const body = doc.body;
  if (!Array.isArray(body) || body.length !== 3 || !body.every((n) => within(n, -BODY_ANGLE, BODY_ANGLE))) {
    throw bad("the body's turn isn't in the right format.");
  }
  if (!within(doc.lift, LIFT[0], LIFT[1])) throw bad("the figure is off the floor by too much.");
  return { joints, body: [body[0], body[1], body[2]], lift: doc.lift };
}

/**
 * A new preset: its kind, sealed name and angles.
 * @param {Record<string, any>} body
 * @returns {{ kind: Kind, name: string, data: PresetData }}
 */
export function parseNewPreset(body) {
  const kind = parseKind(body.kind);
  return { kind, name: parseName(body.name), data: parsePresetData(kind, body.data) };
}
