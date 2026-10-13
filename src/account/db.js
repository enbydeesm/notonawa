// Database queries for the account page: my passkeys, sessions and recovery
// code. Every query is scoped to the signed-in user.

/**
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} currentSessionId
 */
export async function getAccount(db, userId, currentSessionId) {
  const [passkeys, sessions, user] = /** @type {D1Result<Record<string, any>>[]} */ (await db.batch([
    db.prepare(
      `SELECT id, name, prf_capable, created_at, last_used_at FROM passkeys
       WHERE user_id = ? ORDER BY created_at`
    ).bind(userId),
    db.prepare(
      `SELECT s.id, s.kind, s.created_at, s.last_used_at, p.name AS passkey_name
       FROM sessions s LEFT JOIN passkeys p ON p.id = s.passkey_id
       WHERE s.user_id = ? ORDER BY s.last_used_at DESC`
    ).bind(userId),
    db.prepare("SELECT recovery_secret_hash IS NOT NULL AS has_recovery_code FROM users WHERE id = ?").bind(userId),
  ]));
  return {
    passkeys: passkeys.results,
    sessions: sessions.results.map((s) => ({ ...s, current: s.id === currentSessionId })),
    has_recovery_code: !!user.results[0]?.has_recovery_code,
  };
}

/**
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} id
 * @param {string} name
 * @returns {Promise<boolean>} false if it isn't one of mine
 */
export async function renamePasskey(db, userId, id, name) {
  const { meta } = await db.prepare("UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?")
    .bind(name, id, userId).run();
  return meta.changes > 0;
}

/**
 * Removes a passkey (and ends the sessions it started), unless it's my last.
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} id
 * @returns {Promise<"removed" | "last" | "not found">}
 */
export async function removePasskey(db, userId, id) {
  // The count is in the same statement, so two removals at once can't both
  // pass the check and leave no passkeys.
  const { meta } = await db.prepare(
    `DELETE FROM passkeys WHERE id = ? AND user_id = ?
       AND (SELECT count(*) FROM passkeys WHERE user_id = ?) > 1`
  ).bind(id, userId, userId).run();
  if (meta.changes > 0) return "removed";
  const exists = await db.prepare("SELECT 1 FROM passkeys WHERE id = ? AND user_id = ?").bind(id, userId).first();
  return exists ? "last" : "not found";
}

/**
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} id
 * @returns {Promise<boolean>} false if it isn't one of mine
 */
export async function endSession(db, userId, id) {
  const { meta } = await db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return meta.changes > 0;
}

/**
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} keepId the current session
 */
export async function endOtherSessions(db, userId, keepId) {
  await db.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").bind(userId, keepId).run();
}

/**
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} recoveryHash
 */
export async function setRecoveryHash(db, userId, recoveryHash) {
  await db.prepare("UPDATE users SET recovery_secret_hash = ? WHERE id = ?").bind(recoveryHash, userId).run();
}
