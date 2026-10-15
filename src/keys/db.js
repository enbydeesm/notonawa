// Database queries for wrapped keys (migration 0009). Every query is scoped
// to the signed-in user. Functions named ...Statement(s) return prepared
// statements for the caller to run in a batch with others.

/** @typedef {import("./parse.js").Wrap} Wrap */

/**
 * The wraps the browser needs to unlock: the recovery wrap (and whether it
 * matches the current recovery code), and the wrap for one passkey.
 * @param {D1Database} db
 * @param {string} userId
 * @param {string | null} passkeyId the passkey this session signed in with
 */
export async function getWraps(db, userId, passkeyId) {
  const [recovery, passkey] = /** @type {D1Result<Record<string, any>>[]} */ (await db.batch([
    db.prepare(
      `SELECT w.id, w.kind, w.salt, w.iv, w.wrapped, w.version,
              w.recovery_secret_hash IS u.recovery_secret_hash AS current
       FROM key_wraps w JOIN users u ON u.id = w.user_id
       WHERE w.user_id = ? AND w.kind = 'recovery'`
    ).bind(userId),
    db.prepare(
      `SELECT id, kind, salt, iv, wrapped, version FROM key_wraps
       WHERE user_id = ? AND kind = 'passkey' AND passkey_id = ?`
    ).bind(userId, passkeyId),
  ]));
  const recoveryWrap = recovery.results[0];
  return {
    recovery: recoveryWrap ? { ...recoveryWrap, current: !!recoveryWrap.current } : null,
    passkey: passkey.results[0] ?? null,
  };
}

/**
 * @param {D1Database} db
 * @param {string} userId
 */
export async function hasKey(db, userId) {
  return (await db.prepare("SELECT 1 FROM key_wraps WHERE user_id = ? AND kind = 'recovery'").bind(userId).first()) !== null;
}

/**
 * Replaces the recovery code and its wrap together: the hash of its login
 * secret, and the key wrapped for it.
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} recoveryHash
 * @param {Wrap} wrap
 */
export function recoveryWrapStatements(db, userId, recoveryHash, wrap) {
  return [
    db.prepare("UPDATE users SET recovery_secret_hash = ? WHERE id = ?").bind(recoveryHash, userId),
    db.prepare("DELETE FROM key_wraps WHERE user_id = ? AND kind = 'recovery'").bind(userId),
    insertWrapStatement(db, userId, wrap, { kind: "recovery", passkeyId: null, recoveryHash }),
  ];
}

/**
 * Replaces a passkey's wrap. The trigger on key_wraps refuses a passkey that
 * isn't the user's.
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} passkeyId
 * @param {Wrap} wrap
 */
export function passkeyWrapStatements(db, userId, passkeyId, wrap) {
  return [
    db.prepare("DELETE FROM key_wraps WHERE user_id = ? AND passkey_id = ?").bind(userId, passkeyId),
    insertWrapStatement(db, userId, wrap, { kind: "passkey", passkeyId, recoveryHash: null }),
  ];
}

/**
 * Deletes every wrap, for starting a new key.
 * @param {D1Database} db
 * @param {string} userId
 */
export function deleteWrapsStatement(db, userId) {
  return db.prepare("DELETE FROM key_wraps WHERE user_id = ?").bind(userId);
}

/**
 * Adds a wrap (for a new account, or a new passkey: nothing to replace).
 * @param {D1Database} db
 * @param {string} userId
 * @param {Wrap} wrap
 * @param {{ kind: "passkey" | "recovery", passkeyId: string | null, recoveryHash: string | null }} about
 *   recoveryHash: for a recovery wrap, the hash of its code's login secret
 */
export function insertWrapStatement(db, userId, wrap, { kind, passkeyId, recoveryHash }) {
  return db.prepare(
    `INSERT INTO key_wraps (id, user_id, kind, passkey_id, recovery_secret_hash, salt, iv, wrapped, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(wrap.id, userId, kind, passkeyId, recoveryHash, wrap.salt, wrap.iv, wrap.wrapped, wrap.version);
}
