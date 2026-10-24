// Database queries for an item's visuals as one list: where a new one goes,
// and putting them all in order. Every query is kept to one owner's rows.

import { VISUAL_KINDS } from "./parse.js";

/** @typedef {import("../media/parse.js").Item} Item */
/** @typedef {import("./parse.js").VisualRef} VisualRef */

/**
 * SQL for the position after an item's last visual of any kind, so a new
 * photo, drawing or pose goes last among them all.
 * @param {Item["column"]} column a fixed column name (never request data)
 * @param {string} owner the parameter holding the owner's id, e.g. "?2"
 * @param {string} itemId the parameter holding the item's id
 */
export const nextPosition = (column, owner, itemId) => `COALESCE((SELECT MAX(position) FROM (
    SELECT position FROM media WHERE owner_id = ${owner} AND ${column} = ${itemId}
    UNION ALL SELECT position FROM drawings WHERE owner_id = ${owner} AND ${column} = ${itemId}
    UNION ALL SELECT position FROM poses WHERE owner_id = ${owner} AND ${column} = ${itemId})), -1) + 1`;

/**
 * Puts an item's visuals in this order, numbering them from 0, if the list
 * is exactly the visuals it has. All three tables change in one batch, and
 * each update checks the whole list first, so either all change or none do.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {Item} item
 * @param {VisualRef[]} order
 * @returns {Promise<boolean>} false if the list isn't all of them
 */
export async function setVisualOrder(db, ownerId, item, order) {
  const list = JSON.stringify(order);
  const kinds = Object.entries(VISUAL_KINDS);
  const listed = (/** @type {string} */ kind) =>
    `SELECT json_extract(value, '$.id') FROM json_each(?3) WHERE json_extract(value, '$.kind') = '${kind}'`;
  // Every row is listed under its own kind, and there are as many rows as
  // listed: with the ids all different, that's exactly the item's visuals.
  const complete = [
    `(${kinds.map(([, { table }]) => `(SELECT COUNT(*) FROM ${table} WHERE owner_id = ?1 AND ${item.column} = ?2)`).join(" + ")})
      = json_array_length(?3)`,
    ...kinds.map(([kind, { table }]) =>
      `NOT EXISTS (SELECT 1 FROM ${table} WHERE owner_id = ?1 AND ${item.column} = ?2 AND id NOT IN (${listed(kind)}))`),
  ].join(" AND ");
  const results = await db.batch(kinds.map(([kind, { table }]) => db.prepare(
    `UPDATE ${table} SET position = (SELECT CAST(key AS INTEGER) FROM json_each(?3)
        WHERE json_extract(value, '$.kind') = '${kind}' AND json_extract(value, '$.id') = ${table}.id)
      WHERE owner_id = ?1 AND ${item.column} = ?2 AND ${complete}`
  ).bind(ownerId, item.id, list)));
  return results.some((r) => r.meta.changes > 0);
}
