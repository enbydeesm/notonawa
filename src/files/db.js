// Format v3 files' rows in D1: their sizes, for the quota and range reads.
// Nothing here says which item a file is on.

import { accountBytes } from "../sql.js";
import { MAX_ACCOUNT_BYTES } from "../media/parse.js";

/**
 * @typedef {import("./parse.js").Upload} Upload
 */

/**
 * What an upload needs to know first: whether its id is taken, and the
 * account's bytes (and its format 1 media's).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 */
export async function uploadCheck(db, ownerId, id) {
  const row = /** @type {{ taken: number, account_bytes: number, media_bytes: number }} */ (await db.prepare(
    `SELECT (SELECT COUNT(*) FROM files WHERE id = ?2) + (SELECT COUNT(*) FROM media WHERE id = ?2) AS taken,
            ${accountBytes("?1")} AS account_bytes,
            (SELECT COALESCE(SUM(bytes), 0) FROM media WHERE owner_id = ?1) AS media_bytes`
  ).bind(ownerId, id).first());
  return { taken: row.taken > 0, accountBytes: row.account_bytes, mediaBytes: row.media_bytes };
}

/**
 * Adds a file's row if the account has room for it then (checked in the
 * insert itself, so two uploads at once can't both squeeze in).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {Upload} upload
 * @param {boolean} converting format 1 media doesn't count while converting
 * @returns {Promise<boolean>} whether it was added
 */
export async function insertFile(db, ownerId, upload, converting) {
  const result = await db.prepare(
    `INSERT INTO files (id, owner_id, kind, thumb_bytes, bytes)
     SELECT ?1, ?2, ?3, ?4, ?5
      WHERE ${accountBytes("?2")} - (CASE WHEN ?6 THEN (SELECT COALESCE(SUM(bytes), 0) FROM media WHERE owner_id = ?2) ELSE 0 END)
            + ?5 <= ?7`
  ).bind(upload.id, ownerId, upload.kind, upload.thumbBytes, upload.bytes, converting ? 1 : 0, MAX_ACCOUNT_BYTES).run();
  return result.meta.changes === 1;
}

/**
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<{ thumb_bytes: number, bytes: number } | null>}
 */
export function fileSizes(db, ownerId, id) {
  return db.prepare("SELECT thumb_bytes, bytes FROM files WHERE id = ? AND owner_id = ?").bind(id, ownerId).first();
}

/**
 * Every file of mine: ids and sizes, for the device's orphan check.
 * @param {D1Database} db
 * @param {string} ownerId
 */
export async function listFiles(db, ownerId) {
  const { results } = await db.prepare(
    "SELECT id, kind, thumb_bytes, bytes, created_at FROM files WHERE owner_id = ? ORDER BY created_at, id"
  ).bind(ownerId).all();
  return results;
}

/**
 * Deletes some of my files' rows.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string[]} ids
 * @returns {Promise<string[]>} the ids that were mine (their objects are the caller's to delete)
 */
export async function deleteFiles(db, ownerId, ids) {
  const list = JSON.stringify(ids);
  const [found] = await db.batch([
    db.prepare("SELECT id FROM files WHERE owner_id = ?1 AND id IN (SELECT value FROM json_each(?2))").bind(ownerId, list),
    db.prepare("DELETE FROM files WHERE owner_id = ?1 AND id IN (SELECT value FROM json_each(?2))").bind(ownerId, list),
  ]);
  return /** @type {{ id: string }[]} */ (found.results).map((r) => r.id);
}

/**
 * Which of these R2 keys ("<owner>/files/<id>") have a row.
 * @param {D1Database} db
 * @param {string[]} keys
 * @returns {Promise<Set<string>>}
 */
export async function fileKeysWithRows(db, keys) {
  if (keys.length === 0) return new Set();
  const ids = keys.map((key) => key.slice(key.lastIndexOf("/") + 1));
  const { results } = await db.prepare(
    "SELECT owner_id || '/files/' || id AS key FROM files WHERE id IN (SELECT value FROM json_each(?))"
  ).bind(JSON.stringify(ids)).all();
  const found = new Set(results.map((r) => /** @type {string} */ (r.key)));
  return new Set(keys.filter((key) => found.has(key)));
}
