// Database queries for shares. Their sealed files are in R2 (storage.js).
// Everything about a share is kept to its owner, except opening one, which
// is how someone else gets it.

import { NOW, accountBytes } from "../sql.js";
import { MAX_LIVE_SHARES } from "./parse.js";
import { MAX_ACCOUNT_BYTES } from "../media/parse.js";

/** @typedef {import("./parse.js").NewShare} NewShare */

/**
 * A share as its owner sees it in their list: label and link key still
 * sealed.
 * @typedef {{
 *   id: string, kind: string, label: string | null, link_key: string | null, bytes: number, expires_at: string | null,
 *   max_uses: number | null, use_count: number, created_at: string,
 * }} ShareRow
 */

// Not expired. (A used-up share is deleted by the open that used it up.)
const LIVE = `(expires_at IS NULL OR expires_at > ${NOW})`;

/**
 * What a new share needs checking against: whether the id is taken, and
 * the account's live shares and bytes in R2.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<{ taken: boolean, live: number, accountBytes: number }>}
 */
export async function shareCheck(db, ownerId, id) {
  const row = /** @type {any} */ (await db.prepare(
    `SELECT EXISTS(SELECT 1 FROM shares WHERE id = ?2) AS taken,
            (SELECT COUNT(*) FROM shares WHERE owner_id = ?1 AND ${LIVE}) AS live,
            ${accountBytes("?1")} AS account_bytes`
  ).bind(ownerId, id).first());
  return { taken: !!row.taken, live: row.live, accountBytes: row.account_bytes };
}

/**
 * Saves a new share's row. The limits are checked again in the same
 * statement, so two shares made at once can't both squeeze past them.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {NewShare} share
 * @param {number} bytes what its files take up in R2
 * @returns {Promise<boolean>} false if a limit was reached
 */
export async function insertShare(db, ownerId, share, bytes) {
  const row = await db.prepare(
    `INSERT INTO shares (id, owner_id, kind, label, bytes, expires_at, max_uses, link_key)
     SELECT ?1, ?2, ?3, ?4, ?5,
            CASE WHEN ?6 IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?6) END, ?7, ?10
      WHERE (SELECT COUNT(*) FROM shares WHERE owner_id = ?2 AND ${LIVE}) < ?8
        AND ${accountBytes("?2")} + ?5 <= ?9
     RETURNING id`
  ).bind(share.id, ownerId, share.kind, share.label, bytes, share.expires, share.maxUses, MAX_LIVE_SHARES, MAX_ACCOUNT_BYTES,
    share.linkKey).first();
  return row !== null;
}

/**
 * My live shares, newest first.
 * @param {D1Database} db
 * @param {string} ownerId
 * @returns {Promise<ShareRow[]>}
 */
export async function listShares(db, ownerId) {
  const { results } = await db.prepare(
    `SELECT id, kind, label, link_key, bytes, expires_at, max_uses, use_count, created_at
       FROM shares WHERE owner_id = ? AND ${LIVE} ORDER BY created_at DESC, rowid DESC`
  ).bind(ownerId).all();
  return /** @type {ShareRow[]} */ (results);
}

/**
 * Deletes one of my shares' rows (revoking it; the caller deletes its files).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<boolean>} false if it isn't mine
 */
export async function deleteShare(db, ownerId, id) {
  const row = await db.prepare("DELETE FROM shares WHERE id = ? AND owner_id = ? RETURNING id").bind(id, ownerId).first();
  return row !== null;
}

/**
 * A live share being opened. My own opens without counting a use (I'm
 * looking at what I sent). Anyone else's counts one, in the same statement
 * that checks there's one left, so two people can't both take a share
 * that has one use left. null if it's ended or doesn't exist: which, isn't
 * said.
 * @param {D1Database} db
 * @param {string} userId who is opening it
 * @param {string} id
 * @returns {Promise<{ owner_id: string, kind: string, created_at: string, own: boolean, used_up: boolean } | null>}
 */
export async function takeShare(db, userId, id) {
  const [mine, theirs] = /** @type {D1Result<any>[]} */ (await db.batch([
    db.prepare(`SELECT owner_id, kind, created_at FROM shares WHERE id = ?1 AND owner_id = ?2 AND ${LIVE}`).bind(id, userId),
    db.prepare(
      `UPDATE shares SET use_count = use_count + 1
        WHERE id = ?1 AND owner_id <> ?2 AND ${LIVE} AND (max_uses IS NULL OR use_count < max_uses)
       RETURNING owner_id, kind, created_at, use_count, max_uses`
    ).bind(id, userId),
  ]));
  if (mine.results.length > 0) return { ...mine.results[0], own: true, used_up: false };
  if (theirs.results.length === 0) return null;
  const row = theirs.results[0];
  return {
    owner_id: row.owner_id, kind: row.kind, created_at: row.created_at, own: false,
    used_up: row.max_uses !== null && row.use_count >= row.max_uses,
  };
}

/**
 * Deletes a share that's been used up (its last allowed open, just now).
 * @param {D1Database} db
 * @param {string} id
 */
export async function deleteUsedUp(db, id) {
  await db.prepare("DELETE FROM shares WHERE id = ? AND max_uses IS NOT NULL AND use_count >= max_uses").bind(id).run();
}

/**
 * Deletes every share that has ended (expired, or used up but left by an
 * open that stopped half-way), for the daily clean-up.
 * @param {D1Database} db
 * @returns {Promise<{ owner_id: string, id: string }[]>} the deleted ones, whose files the caller deletes
 */
export async function deleteEndedShares(db) {
  const { results } = await db.prepare(
    `DELETE FROM shares WHERE NOT ${LIVE} OR (max_uses IS NOT NULL AND use_count >= max_uses)
     RETURNING owner_id, id`
  ).all();
  return /** @type {{ owner_id: string, id: string }[]} */ (results);
}

/**
 * A statement deleting all of a user's shares (starting a new key: their
 * labels couldn't be opened any more, and their files are deleted with the
 * rest of the account's).
 * @param {D1Database} db
 * @param {string} ownerId
 */
export function deleteAllSharesStatement(db, ownerId) {
  return db.prepare("DELETE FROM shares WHERE owner_id = ?").bind(ownerId);
}

/**
 * Of these shares, the ones that have a row (for the daily sweep of files
 * left without one).
 * @param {D1Database} db
 * @param {{ ownerId: string, shareId: string }[]} shares
 * @returns {Promise<Set<string>>} "<owner id>/<share id>" of each that does
 */
export async function sharesWithRows(db, shares) {
  if (shares.length === 0) return new Set();
  const { results } = await db.prepare(
    "SELECT owner_id || '/' || id AS key FROM shares WHERE id IN (SELECT value FROM json_each(?))"
  ).bind(JSON.stringify(shares.map((s) => s.shareId))).all();
  return new Set(results.map((r) => /** @type {string} */ (r.key)));
}
