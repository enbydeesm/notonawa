// Database queries for saved poser presets. Every query is kept to one
// owner's rows.

import { NOW } from "../sql.js";
import { MAX_PRESETS } from "./parse.js";

/** @typedef {import("./parse.js").Kind} Kind */
/** @typedef {import("./parse.js").PresetData} PresetData */

/**
 * A preset as the page gets it, its name still sealed.
 * @typedef {{ id: string, kind: Kind, name: string | null, data: PresetData, created_at: string, updated_at: string }} PresetRow
 */

/**
 * My presets, oldest first, so each list keeps its order as more are saved
 * (then by rowid: several can be saved in the same second).
 * @param {D1Database} db
 * @param {string} ownerId
 * @returns {Promise<PresetRow[]>}
 */
export async function listPresets(db, ownerId) {
  const { results } = await db.prepare(
    "SELECT id, kind, name, data, created_at, updated_at FROM pose_presets WHERE owner_id = ? ORDER BY created_at, rowid"
  ).bind(ownerId).all();
  return /** @type {Record<string, any>[]} */ (results).map((r) => /** @type {PresetRow} */ ({ ...r, data: JSON.parse(r.data) }));
}

/**
 * Adds a preset if the account has room (checked in the same statement, so
 * two at once can't pass the limit).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {{ id: string, kind: Kind, name: string, data: PresetData }} preset
 * @returns {Promise<boolean>} false if the account has as many as it can keep
 */
export async function insertPreset(db, ownerId, { id, kind, name, data }) {
  const row = await db.prepare(
    `INSERT INTO pose_presets (id, owner_id, kind, name, data)
     SELECT ?1, ?2, ?3, ?4, ?5
      WHERE (SELECT COUNT(*) FROM pose_presets WHERE owner_id = ?2) < ?6
     RETURNING id`
  ).bind(id, ownerId, kind, name, JSON.stringify(data), MAX_PRESETS).first();
  return row !== null;
}

/**
 * Renames a preset.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @param {string} name sealed
 * @returns {Promise<boolean>} false if it isn't mine
 */
export async function renamePreset(db, ownerId, id, name) {
  const result = await db.prepare(
    `UPDATE pose_presets SET name = ?, updated_at = ${NOW} WHERE id = ? AND owner_id = ?`
  ).bind(name, id, ownerId).run();
  return result.meta.changes > 0;
}

/**
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<boolean>} false if it isn't mine
 */
export async function deletePreset(db, ownerId, id) {
  const row = await db.prepare("DELETE FROM pose_presets WHERE id = ? AND owner_id = ? RETURNING id").bind(id, ownerId).first();
  return row !== null;
}
