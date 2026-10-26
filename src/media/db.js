// Database queries for photos (the media table). The files are in R2
// (storage.js); every query here is kept to one owner's rows.

import { nextPosition } from "../visuals/db.js";
import { accountBytes } from "../sql.js";
import { MAX_PER_ITEM, MAX_VIDEOS_PER_ITEM, MAX_ACCOUNT_BYTES } from "./parse.js";

/** @typedef {import("./parse.js").Item} Item */
/** @typedef {import("./parse.js").Upload} Upload */

/**
 * A photo as the page gets it: caption still sealed.
 * @typedef {{
 *   id: string, kind: string, mime: string, caption: string | null,
 *   position: number, bytes: number, created_at: string,
 * }} MediaRow
 */

const COLUMNS = "id, kind, mime, caption, position, bytes, created_at";

/**
 * An item's photos, first to last. null if the item isn't mine.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {Item} item
 * @returns {Promise<MediaRow[] | null>}
 */
export async function listMedia(db, ownerId, item) {
  const [found, media] = await db.batch([
    db.prepare(`SELECT 1 FROM ${item.table} WHERE id = ? AND owner_id = ?`).bind(item.id, ownerId),
    db.prepare(
      `SELECT ${COLUMNS} FROM media WHERE owner_id = ? AND ${item.column} = ? ORDER BY position, created_at`
    ).bind(ownerId, item.id),
  ]);
  if (found.results.length === 0) return null;
  return /** @type {MediaRow[]} */ (media.results);
}

/**
 * What an upload needs checking against: whether the item is mine, whether
 * the id is already used, and what's stored already.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {Upload} upload
 * @returns {Promise<{ item: boolean, taken: boolean, count: number, videoCount: number, accountBytes: number }>}
 */
export async function uploadCheck(db, ownerId, upload) {
  const row = /** @type {any} */ (await db.prepare(
    `SELECT EXISTS(SELECT 1 FROM ${upload.item.table} WHERE id = ?2 AND owner_id = ?1) AS item,
            EXISTS(SELECT 1 FROM media WHERE id = ?3) AS taken,
            (SELECT COUNT(*) FROM media WHERE owner_id = ?1 AND ${upload.item.column} = ?2) AS count,
            (SELECT COUNT(*) FROM media WHERE owner_id = ?1 AND ${upload.item.column} = ?2 AND kind = 'video') AS video_count,
            ${accountBytes("?1")} AS account_bytes`
  ).bind(ownerId, upload.item.id, upload.id).first());
  return { item: !!row.item, taken: !!row.taken, count: row.count, videoCount: row.video_count, accountBytes: row.account_bytes };
}

/**
 * Saves an uploaded photo's row, last in its item. The limits are checked
 * again in the same statement, so two uploads at once can't both squeeze
 * past them.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {Upload} upload
 * @returns {Promise<number | null>} its position, or null if a limit was reached
 */
export async function insertMedia(db, ownerId, upload) {
  const { item } = upload;
  const row = await db.prepare(
    `INSERT INTO media (id, owner_id, tie_id, plan_id, workshop_id, kind, mime, position, thumb_bytes, bytes)
     SELECT ?1, ?2, ?3, ?4, ?13, ?5, ?6,
            ${nextPosition(item.column, "?2", "?7")},
            ?8, ?9
      WHERE (SELECT COUNT(*) FROM media WHERE owner_id = ?2 AND ${item.column} = ?7) < ?10
        AND ${accountBytes("?2")} + ?9 <= ?11
        AND (?5 <> 'video'
             OR (SELECT COUNT(*) FROM media WHERE owner_id = ?2 AND ${item.column} = ?7 AND kind = 'video') < ?12)
     RETURNING position`
  ).bind(
    upload.id, ownerId,
    item.column === "tie_id" ? item.id : null, item.column === "plan_id" ? item.id : null,
    upload.kind, upload.mime, item.id, upload.thumbBytes, upload.bytes, MAX_PER_ITEM, MAX_ACCOUNT_BYTES,
    MAX_VIDEOS_PER_ITEM, item.column === "workshop_id" ? item.id : null,
  ).first();
  return row ? /** @type {number} */ (row.position) : null;
}

/**
 * Where a photo's thumbnail ends in its object. null if it isn't mine.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<{ thumb_bytes: number, bytes: number } | null>}
 */
export function getMediaSizes(db, ownerId, id) {
  return db.prepare("SELECT thumb_bytes, bytes FROM media WHERE id = ? AND owner_id = ?").bind(id, ownerId).first();
}

/**
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @param {string | null} caption sealed
 * @returns {Promise<boolean>} false if it isn't mine
 */
export async function setCaption(db, ownerId, id, caption) {
  const result = await db.prepare("UPDATE media SET caption = ? WHERE id = ? AND owner_id = ?")
    .bind(caption, id, ownerId).run();
  return result.meta.changes > 0;
}

/**
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<boolean>} false if it isn't mine
 */
export async function deleteMedia(db, ownerId, id) {
  const row = await db.prepare("DELETE FROM media WHERE id = ? AND owner_id = ? RETURNING id").bind(id, ownerId).first();
  return row !== null;
}

/**
 * A statement listing the photos a tie, plan or workshop has, to run in the same
 * batch as deleting it (the rows go with it; the caller then deletes the
 * files).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {Item["column"]} column
 * @param {string} itemId
 */
export function mediaOfStatement(db, ownerId, column, itemId) {
  return db.prepare(`SELECT id FROM media WHERE owner_id = ? AND ${column} = ?`).bind(ownerId, itemId);
}

/**
 * A statement deleting all of a user's photo rows (starting a new key: the
 * new key couldn't open them).
 * @param {D1Database} db
 * @param {string} ownerId
 */
export function deleteAllMediaStatement(db, ownerId) {
  return db.prepare("DELETE FROM media WHERE owner_id = ?").bind(ownerId);
}

/**
 * Of these R2 keys ("<owner>/<id>"), the ones that have a row.
 * @param {D1Database} db
 * @param {string[]} keys
 * @returns {Promise<Set<string>>}
 */
export async function keysWithRows(db, keys) {
  if (keys.length === 0) return new Set();
  // Looked up by id (the primary key), then matched on the whole key.
  const ids = keys.map((key) => key.slice(key.indexOf("/") + 1));
  const { results } = await db.prepare(
    "SELECT owner_id || '/' || id AS key FROM media WHERE id IN (SELECT value FROM json_each(?))"
  ).bind(JSON.stringify(ids)).all();
  const found = new Set(results.map((r) => /** @type {string} */ (r.key)));
  return new Set(keys.filter((key) => found.has(key)));
}
