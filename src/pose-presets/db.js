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
 * A preset's kind, to check new angles against.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<Kind | null>} null if it isn't mine
 */
export async function presetKind(db, ownerId, id) {
  const row = await db.prepare("SELECT kind FROM pose_presets WHERE id = ? AND owner_id = ?").bind(id, ownerId).first();
  return row ? /** @type {Kind} */ (row.kind) : null;
}

/**
 * Renames a preset and/or saves new angles over its own (null leaves either as it is).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @param {{ name: string | null, data: PresetData | null }} change the name sealed
 * @returns {Promise<boolean>} false if it isn't mine
 */
export async function updatePreset(db, ownerId, id, { name, data }) {
  const result = await db.prepare(
    `UPDATE pose_presets SET name = COALESCE(?, name), data = COALESCE(?, data), updated_at = ${NOW}
      WHERE id = ? AND owner_id = ?`
  ).bind(name, data === null ? null : JSON.stringify(data), id, ownerId).run();
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
