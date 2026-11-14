// Saved poser presets, through today's API (format 1): names sealed here,
// opened when listed. pose-presets.js keeps them in memory while unlocked.
// See store/index.js.

import { api } from "../../api.js";
import { open, seal, sealOne } from "../../vault.js";

/**
 * A saved preset, its name opened (null if it couldn't be).
 * @typedef {{ id: string, kind: "body" | "arms", name: string | null, data: Record<string, any> }} SavedPreset
 */

/**
 * My saved presets, oldest first.
 * @returns {Promise<SavedPreset[]>}
 */
export async function listPosePresets() {
  /** @type {SavedPreset[]} */
  const listed = await api("/api/pose-presets");
  return (await open("posePreset", listed)).map(({ id, kind, name, data }) => ({ id, kind, name, data }));
}

/**
 * Adds presets, in order (import adds several).
 * @param {{ kind: "body" | "arms", name: string, data: Record<string, any> }[]} presets
 * @returns {Promise<string[]>} their ids
 */
export async function addPosePresets(presets) {
  const names = await seal("posePreset", presets.map((p) => ({ name: p.name })));
  /** @type {string[]} */
  const ids = [];
  for (const [i, p] of presets.entries()) {
    ids.push((await api("/api/pose-presets", { method: "POST", body: { kind: p.kind, name: names[i].name, data: p.data } })).id);
  }
  return ids;
}

/**
 * @param {string} id
 * @param {string} name
 */
export async function renamePosePreset(id, name) {
  const { name: sealed } = await sealOne("posePreset", { name });
  await api(`/api/pose-presets/${encodeURIComponent(id)}`, { method: "PUT", body: { name: sealed } });
}

/**
 * Saves new angles over a preset's, keeping its name.
 * @param {string} id
 * @param {Record<string, any>} data
 */
export async function setPosePresetData(id, data) {
  await api(`/api/pose-presets/${encodeURIComponent(id)}`, { method: "PUT", body: { data } });
}

/** @param {string} id */
export async function deletePosePreset(id) {
  await api(`/api/pose-presets/${encodeURIComponent(id)}`, { method: "DELETE" });
}
