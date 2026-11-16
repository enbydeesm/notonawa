// Saved poser presets: the body and arms positions someone saved, theirs to
// start any pose from (src/pose-presets/). Read once the poser is first
// opened and kept while the journal is unlocked (their names are opened,
// so they're dropped on lock); saving, renaming, saving over and deleting keep the copy
// up to date. Reading and writing them, names sealed, is the store's.

import { onWipe } from "./vault.js";
import {
  listPosePresets, addPosePresets, renamePosePreset, setPosePresetData, deletePosePreset,
} from "./store/index.js";

/** @typedef {import("./store/v1/presets.js").SavedPreset} SavedPreset */

/** @type {Promise<SavedPreset[]> | null} */
let loaded = null;

onWipe(() => {
  loaded = null;
});

/**
 * My saved presets, oldest first.
 * @returns {Promise<SavedPreset[]>}
 */
export function savedPresets() {
  loaded ??= listPosePresets();
  // A failed read is tried again next time.
  loaded.catch(() => { loaded = null; });
  return loaded;
}

/**
 * Saves a new preset.
 * @param {"body" | "arms"} kind
 * @param {string} name
 * @param {Record<string, any>} data the angles (figure-rig.js's bodyPresetFrom or armsPresetFrom, without the name)
 * @returns {Promise<SavedPreset>}
 */
export async function savePreset(kind, name, data) {
  const [id] = await addPosePresets([{ kind, name, data }]);
  const preset = { id, kind, name: name.trim(), data };
  const list = await savedPresets();
  list.push(preset);
  return preset;
}

/**
 * @param {string} id
 * @param {string} name
 */
export async function renamePreset(id, name) {
  await renamePosePreset(id, name);
  const preset = (await savedPresets()).find((p) => p.id === id);
  if (preset) preset.name = name.trim();
}

/**
 * Saves the figure's angles now over a preset's, keeping its name.
 * @param {string} id
 * @param {Record<string, any>} data as savePreset's
 */
export async function overwritePreset(id, data) {
  await setPosePresetData(id, data);
  const preset = (await savedPresets()).find((p) => p.id === id);
  if (preset) preset.data = data;
}

/** @param {string} id */
export async function deletePreset(id) {
  await deletePosePreset(id);
  const list = await savedPresets();
  const at = list.findIndex((p) => p.id === id);
  if (at >= 0) list.splice(at, 1);
}

/** @param {SavedPreset} preset what the poser's menus and lists show for it */
export const presetLabel = (preset) => preset.name ?? "(name couldn't be read)";
