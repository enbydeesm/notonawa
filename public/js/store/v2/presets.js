// Saved poser presets over the journal in memory (format 2): the same
// functions as v1/presets.js. Each is a record ({ kind, name, data }), up
// to 50 an account, as the server allowed.

import { records, record, save } from "./journal.js";
import { newId } from "../../records/ids.js";
import { stamp, requiredText, BadEdit } from "../../records/parse.js";

/** @typedef {import("../v1/presets.js").SavedPreset} SavedPreset */

export const MAX_PRESETS = 50;

/**
 * My saved presets, oldest first.
 * @returns {Promise<SavedPreset[]>}
 */
export async function listPosePresets() {
  return records("pose_preset")
    .sort((a, b) => {
      const x = `${a.body?.created_at ?? ""}|${a.id}`;
      const y = `${b.body?.created_at ?? ""}|${b.id}`;
      return x < y ? -1 : x > y ? 1 : 0;
    })
    .map((p) => ({ id: p.id, kind: p.body?.kind, name: p.body?.name ?? null, data: p.body?.data }));
}

/**
 * Adds presets, in order (import adds several), in one save.
 * @param {{ kind: "body" | "arms", name: string, data: Record<string, any> }[]} presets
 * @returns {Promise<string[]>} their ids
 */
export async function addPosePresets(presets) {
  if (records("pose_preset").length + presets.length > MAX_PRESETS) {
    throw new BadEdit(`You can keep up to ${MAX_PRESETS} presets. Delete one to save another.`);
  }
  const now = stamp();
  const writes = presets.map((p) => {
    if (p.kind !== "body" && p.kind !== "arms") throw new BadEdit("A preset is for the body or the arms.");
    return { kind: /** @type {const} */ ("pose_preset"), id: newId(),
      body: { kind: p.kind, name: requiredText(p.name, "A preset needs a name."), data: p.data, created_at: now, updated_at: now } };
  });
  await save({ writes });
  return writes.map((w) => w.id);
}

/** @param {string} id */
function presetOf(id) {
  const entry = record(id);
  if (!entry || entry.kind !== "pose_preset") throw new Error("Not found");
  return entry;
}

/**
 * @param {string} id
 * @param {string} name
 */
export async function renamePosePreset(id, name) {
  const entry = presetOf(id);
  await save({ writes: [{ kind: "pose_preset", id, from: entry.body ?? undefined,
    body: { ...entry.body, name: requiredText(name, "A preset needs a name."), updated_at: stamp() } }] });
}

/**
 * Saves new angles over a preset's, keeping its name.
 * @param {string} id
 * @param {Record<string, any>} data
 */
export async function setPosePresetData(id, data) {
  const entry = presetOf(id);
  await save({ writes: [{ kind: "pose_preset", id, from: entry.body ?? undefined, body: { ...entry.body, data, updated_at: stamp() } }] });
}

/** @param {string} id */
export async function deletePosePreset(id) {
  presetOf(id);
  await save({ deletes: [{ kind: "pose_preset", id }] });
}
