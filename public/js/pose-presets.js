// Saved poser presets: the body and arms positions someone saved, theirs to
// start any pose from (src/pose-presets/). Read once the poser is first
// opened and kept while the journal is unlocked (their names are opened,
// so they're dropped on lock); saving, renaming and deleting keep the copy
// up to date. Names are sealed before they're sent.

import { api } from "./api.js";
import { open, sealOne, onWipe } from "./vault.js";

/**
 * A saved preset, its name opened (null if it couldn't be).
 * @typedef {{ id: string, kind: "body" | "arms", name: string | null, data: Record<string, any> }} SavedPreset
 */

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
  loaded ??= (async () => {
    /** @type {SavedPreset[]} */
    const listed = await api("/api/pose-presets");
    return (await open("posePreset", listed)).map(({ id, kind, name, data }) => ({ id, kind, name, data }));
  })();
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
  const { name: sealed } = await sealOne("posePreset", { name });
  const { id } = await api("/api/pose-presets", { method: "POST", body: { kind, name: sealed, data } });
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
  const { name: sealed } = await sealOne("posePreset", { name });
  await api(`/api/pose-presets/${id}`, { method: "PUT", body: { name: sealed } });
  const preset = (await savedPresets()).find((p) => p.id === id);
  if (preset) preset.name = name.trim();
}

/** @param {string} id */
export async function deletePreset(id) {
  await api(`/api/pose-presets/${id}`, { method: "DELETE" });
  const list = await savedPresets();
  const at = list.findIndex((p) => p.id === id);
  if (at >= 0) list.splice(at, 1);
}

/** @param {SavedPreset} preset what the poser's menus and lists show for it */
export const presetLabel = (preset) => preset.name ?? "(name couldn't be read)";
