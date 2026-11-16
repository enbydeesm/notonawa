// Identity keys in D1, one per account.

import { NOW } from "../sql.js";

/**
 * @param {D1Database} db
 * @param {string} userId
 * @returns {Promise<{ public_key: string, sealed_seed: string, created_at: string } | null>}
 */
export function getIdentity(db, userId) {
  return db.prepare("SELECT public_key, sealed_seed, created_at FROM identity_keys WHERE user_id = ?").bind(userId).first();
}

/**
 * Saves the account's first identity key; does nothing if it has one.
 * @param {D1Database} db
 * @param {string} userId
 * @param {{ publicKey: string, sealedSeed: string }} identity
 * @returns {Promise<boolean>} whether it was saved
 */
export async function addIdentity(db, userId, { publicKey, sealedSeed }) {
  const result = await db.prepare("INSERT OR IGNORE INTO identity_keys (user_id, public_key, sealed_seed) VALUES (?, ?, ?)")
    .bind(userId, publicKey, sealedSeed).run();
  return result.meta.changes === 1;
}

/**
 * Replaces the account's identity key.
 * @param {D1Database} db
 * @param {string} userId
 * @param {{ publicKey: string, sealedSeed: string }} identity
 */
export async function replaceIdentity(db, userId, { publicKey, sealedSeed }) {
  await db.prepare(`UPDATE identity_keys SET public_key = ?, sealed_seed = ?, created_at = ${NOW} WHERE user_id = ?`)
    .bind(publicKey, sealedSeed, userId).run();
}
