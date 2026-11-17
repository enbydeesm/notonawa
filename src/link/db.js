// Link requests (migration 0034): signing in on a new device by scanning a
// code with one that's signed in. Every query is either by the request's
// random id and its poll token's hash (the new device, signed out) or by id
// and the signed-in user (the approving device).

import { NOW } from "../sql.js";
import { isoAt } from "../auth/session.js";
import { LINK_MINUTES } from "./parse.js";

/**
 * A new request, clearing expired ones in the same batch (no one can use
 * them; the daily job would too).
 * @param {D1Database} db
 * @param {{ id: string, pollHash: string, publicKey: string }} request
 * @param {number} [now]
 * @returns {Promise<string>} when it expires
 */
export async function insertLink(db, { id, pollHash, publicKey }, now = Date.now()) {
  const expiresAt = isoAt(now + LINK_MINUTES * 60 * 1000);
  await db.batch([
    db.prepare(`DELETE FROM link_requests WHERE expires_at <= ${NOW}`),
    db.prepare("INSERT INTO link_requests (id, poll_hash, public_key, expires_at) VALUES (?, ?, ?, ?)")
      .bind(id, pollHash, publicKey, expiresAt),
  ]);
  return expiresAt;
}

/**
 * The request as its new device sees it, if its poll token matches and it
 * hasn't expired.
 * @param {D1Database} db
 * @param {string} id
 * @param {string} pollHash
 * @returns {Promise<{ user_id: string | null, sealed_key: string | null } | null>}
 */
export function linkForPoll(db, id, pollHash) {
  return db.prepare(
    `SELECT user_id, sealed_key FROM link_requests WHERE id = ? AND poll_hash = ? AND expires_at > ${NOW}`
  ).bind(id, pollHash).first();
}

/**
 * Takes an approved request: deletes it, so only one answer can start a
 * session from it (two status checks at once: the one that deleted it).
 * @param {D1Database} db
 * @param {string} id
 * @param {string} pollHash
 * @returns {Promise<boolean>} whether this call took it
 */
export async function takeLink(db, id, pollHash) {
  const result = await db.prepare(
    `DELETE FROM link_requests WHERE id = ? AND poll_hash = ? AND user_id IS NOT NULL AND expires_at > ${NOW}`
  ).bind(id, pollHash).run();
  return result.meta.changes === 1;
}

/**
 * The public key of a request no one has approved yet, for the approving
 * device.
 * @param {D1Database} db
 * @param {string} id
 * @returns {Promise<{ public_key: string, expires_at: string } | null>}
 */
export function waitingLink(db, id) {
  return db.prepare(
    `SELECT public_key, expires_at FROM link_requests WHERE id = ? AND user_id IS NULL AND expires_at > ${NOW}`
  ).bind(id).first();
}

/**
 * Approves a waiting request for me, with the data key sealed to its public
 * key.
 * @param {D1Database} db
 * @param {string} id
 * @param {string} userId
 * @param {string} sealedKey
 * @returns {Promise<boolean>} whether it was still waiting
 */
export async function approveLink(db, id, userId, sealedKey) {
  const result = await db.prepare(
    `UPDATE link_requests SET user_id = ?, sealed_key = ?, approved_at = ${NOW}
      WHERE id = ? AND user_id IS NULL AND expires_at > ${NOW}`
  ).bind(userId, sealedKey, id).run();
  return result.meta.changes === 1;
}

/**
 * Declines a request: one waiting, or one I approved that hasn't been
 * picked up yet.
 * @param {D1Database} db
 * @param {string} id
 * @param {string} userId
 */
export async function declineLink(db, id, userId) {
  await db.prepare("DELETE FROM link_requests WHERE id = ? AND (user_id IS NULL OR user_id = ?)").bind(id, userId).run();
}
