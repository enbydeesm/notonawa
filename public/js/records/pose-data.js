// A pose's own data as it's saved (format 2), as format 1's server saved it
// (src/poses/parse.js): every joint the figure has, a movement left out at
// rest (0), and an older four-number camera as not panned sideways. The
// poser always saves whole poses; this is for anything else that saves one
// (an import, a test) and for older poses. Pure.

import { JOINTS } from "../figure-rig.js";
import { BadEdit } from "./parse.js";

/**
 * @param {unknown} value a pose's data: { v: 2 (or 1), joints, camera, … }
 * @returns {Record<string, any>}
 */
export function poseData(value) {
  const bad = (/** @type {string} */ why) => new BadEdit(`Couldn't save the pose: ${why}`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad("it was missing.");
  const doc = /** @type {Record<string, any>} */ (value);
  // Format 1's hips turned Out first: kept as they were, and turned when read (hip-order.js).
  if (doc.v !== 1 && doc.v !== 2) throw bad("it's from a newer version of nōtonawa. Reload the page and try again.");
  const sent = doc.joints;
  if (!sent || typeof sent !== "object" || Array.isArray(sent)) throw bad("it has no joints.");
  const known = new Set(JOINTS.map((j) => j.name));
  if (Object.keys(sent).some((name) => !known.has(name))) throw bad("it has a joint nōtonawa doesn't know.");
  /** @type {Record<string, number[]>} */
  const joints = {};
  for (const joint of JOINTS) {
    const angles = Array.isArray(sent[joint.name]) ? sent[joint.name] : [];
    if (angles.length > joint.moves.length || angles.some((a) => typeof a !== "number" || !Number.isFinite(a))) {
      throw bad("a joint isn't in the right format.");
    }
    joints[joint.name] = [...angles, ...joint.moves.slice(angles.length).map(() => 0)];
  }
  const camera = Array.isArray(doc.camera) && doc.camera.length === 4 ? [...doc.camera, 0, 0] : doc.camera;
  return { ...doc, joints, camera };
}
