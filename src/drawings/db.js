// Database queries for drawings. Every query is kept to one owner's rows.

import { NOW } from "../sql.js";
import { MAX_PER_ITEM } from "./parse.js";

/** @typedef {import("../media/parse.js").Item} Item */
/** @typedef {import("./parse.js").Drawing} Drawing */

/**
 * A drawing as the page gets it: its lines, and its caption still sealed.
 * @typedef {{
 *   id: string, data: Drawing, caption: string | null, position: number,
 *   created_at: string, updated_at: string,
 * }} DrawingRow
 */

/**
 * An item's drawings, first to last. null if the item isn't mine.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {Item} item
 * @returns {Promise<DrawingRow[] | null>}
 */
export async function listDrawings(db, ownerId, item) {
  const [found, drawings] = await db.batch([
    db.prepare(`SELECT 1 FROM ${item.table} WHERE id = ? AND owner_id = ?`).bind(item.id, ownerId),
    db.prepare(
      `SELECT id, data, caption, position, created_at, updated_at FROM drawings
        WHERE owner_id = ? AND ${item.column} = ? ORDER BY position, created_at`
    ).bind(ownerId, item.id),
  ]);
  if (found.results.length === 0) return null;
  const rows = /** @type {Record<string, any>[]} */ (drawings.results);
  return rows.map((r) => /** @type {DrawingRow} */ ({ ...r, data: JSON.parse(r.data) }));
}

/**
 * Adds a drawing, last on its item, if the item is mine and has room (both
 * checked in the same statement, so two at once can't pass the limit).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {{ id: string, item: Item, data: Drawing, caption: string | null }} drawing
 * @returns {Promise<{ position: number } | { problem: "missing" | "full" }>}
 */
export async function insertDrawing(db, ownerId, { id, item, data, caption }) {
  const [inserted, check] = await db.batch([
    db.prepare(
      `INSERT INTO drawings (id, owner_id, tie_id, plan_id, workshop_id, data, caption, position)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7,
              COALESCE((SELECT MAX(position) FROM drawings WHERE owner_id = ?2 AND ${item.column} = ?8), -1) + 1
        WHERE EXISTS (SELECT 1 FROM ${item.table} WHERE id = ?8 AND owner_id = ?2)
          AND (SELECT COUNT(*) FROM drawings WHERE owner_id = ?2 AND ${item.column} = ?8) < ?9
       RETURNING position`
    ).bind(
      id, ownerId,
      item.column === "tie_id" ? item.id : null, item.column === "plan_id" ? item.id : null,
      item.column === "workshop_id" ? item.id : null,
      JSON.stringify(data), caption, item.id, MAX_PER_ITEM,
    ),
    // Read after the insert, in the same transaction: says why nothing was added.
    db.prepare(`SELECT EXISTS (SELECT 1 FROM ${item.table} WHERE id = ? AND owner_id = ?) AS mine`).bind(item.id, ownerId),
  ]);
  const row = /** @type {{ position: number } | undefined} */ (inserted.results[0]);
  if (row) return { position: row.position };
  return { problem: /** @type {{ mine: number }} */ (check.results[0]).mine ? "full" : "missing" };
}

/**
 * Saves an edit: new lines, a new caption, or both.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @param {{ data?: Drawing, caption?: string | null }} edit
 * @returns {Promise<boolean>} false if it isn't mine
 */
export async function updateDrawing(db, ownerId, id, edit) {
  // Only fixed column names go into the SQL; the values are bound.
  const sets = [];
  const values = [];
  if (edit.data) {
    sets.push("data = ?");
    values.push(JSON.stringify(edit.data));
  }
  if ("caption" in edit) {
    sets.push("caption = ?");
    values.push(edit.caption);
  }
  const result = await db.prepare(
    `UPDATE drawings SET ${sets.join(", ")}, updated_at = ${NOW} WHERE id = ? AND owner_id = ?`
  ).bind(...values, id, ownerId).run();
  return result.meta.changes > 0;
}

/**
 * Puts an item's drawings in this order, numbering them from 0, if ids is
 * exactly the drawings it has.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {Item} item
 * @param {string[]} ids
 * @returns {Promise<boolean>} false if ids aren't all of them
 */
export async function setOrder(db, ownerId, item, ids) {
  const list = JSON.stringify(ids);
  const result = await db.prepare(
    `UPDATE drawings SET position = (SELECT CAST(key AS INTEGER) FROM json_each(?3) WHERE value = drawings.id)
      WHERE owner_id = ?1 AND ${item.column} = ?2
        AND (SELECT COUNT(*) FROM drawings WHERE owner_id = ?1 AND ${item.column} = ?2) = json_array_length(?3)
        AND NOT EXISTS (SELECT 1 FROM drawings WHERE owner_id = ?1 AND ${item.column} = ?2
                         AND id NOT IN (SELECT value FROM json_each(?3)))`
  ).bind(ownerId, item.id, list).run();
  return result.meta.changes > 0 || ids.length === 0;
}

/**
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<boolean>} false if it isn't mine
 */
export async function deleteDrawing(db, ownerId, id) {
  const row = await db.prepare("DELETE FROM drawings WHERE id = ? AND owner_id = ? RETURNING id").bind(id, ownerId).first();
  return row !== null;
}
