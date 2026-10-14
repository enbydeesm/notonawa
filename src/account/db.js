// Database queries for the account page: my passkeys, sessions, recovery
// code and recovery email. Every query is scoped to the signed-in user.

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
    db.prepare(
      `SELECT recovery_secret_hash IS NOT NULL AS has_recovery_code,
              recovery_email_hash IS NOT NULL AS has_recovery_email
       FROM users WHERE id = ?`
    ).bind(userId),
  ]));
  return {
    passkeys: passkeys.results,
    sessions: sessions.results.map((s) => ({ ...s, current: s.id === currentSessionId })),
    has_recovery_code: !!user.results[0]?.has_recovery_code,
    has_recovery_email: !!user.results[0]?.has_recovery_email,
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

/**
 * Sets (or with null, removes) my recovery email's hash and salt, together.
 * @param {D1Database} db
 * @param {string} userId
 * @param {{ emailHash: string, salt: string } | null} email
 */
export async function setRecoveryEmail(db, userId, email) {
  await db.prepare("UPDATE users SET recovery_email_hash = ?, recovery_email_salt = ? WHERE id = ?")
    .bind(email?.emailHash ?? null, email?.salt ?? null, userId).run();
}

/**
 * Deletes my account and everything in it. Every table hangs off users with
 * ON DELETE CASCADE (directly, or through a parent row), so one DELETE takes
 * the journal, passkeys, sessions and challenges with it. An invite I used
 * stays marked used, with used_by cleared; other people's links to me
 * (people.linked_user_id) are cleared too.
 * @param {D1Database} db
 * @param {string} userId
 * @returns {Promise<string[]>} my passkeys' ids, so the browser can be told
 *   they're gone (see public/js/pages/account.js)
 */
export async function deleteAccount(db, userId) {
  const [passkeys] = /** @type {D1Result<{ id: string }>[]} */ (await db.batch([
    db.prepare("SELECT id FROM passkeys WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]));
  return passkeys.results.map((p) => p.id);
}
