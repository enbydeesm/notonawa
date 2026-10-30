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
      `SELECT id, name, prf_capable, created_at, last_used_at,
              EXISTS (SELECT 1 FROM key_wraps w WHERE w.passkey_id = passkeys.id) AS unlocks
       FROM passkeys WHERE user_id = ? ORDER BY created_at`
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
    passkeys: passkeys.results.map((p) => ({ ...p, unlocks: !!p.unlocks })),
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
 * stays marked used, with used_by cleared. My connections go from both
 * sides (connections cascade on owner and peer), which takes them off
 * other people's cards (people.connection_id), as are the old, unused
 * people.linked_user_id links.
 * @param {D1Database} db
 * @param {string} userId
 * @returns {Promise<string[]>} my passkeys' ids, so the browser can be told
 *   they're gone (see public/js/views/account.js)
 */
export async function deleteAccount(db, userId) {
  const [passkeys] = /** @type {D1Result<{ id: string }>[]} */ (await db.batch([
    db.prepare("SELECT id FROM passkeys WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]));
  return passkeys.results.map((p) => p.id);
}

/**
 * My settings: role names, light/dark mode, the last release notes seen and
 * whether to show the welcome (see settings.js).
 * @param {D1Database} db
 * @param {string} userId
 * @returns {Promise<import("./settings.js").Settings>}
 */
export async function getSettings(db, userId) {
  const row = await db.prepare("SELECT top_label, bottom_label, theme, seen_release, hide_welcome, default_shape FROM users WHERE id = ?")
    .bind(userId).first();
  return {
    top_label: /** @type {string | null} */ (row?.top_label ?? null),
    bottom_label: /** @type {string | null} */ (row?.bottom_label ?? null),
    theme: /** @type {string | null} */ (row?.theme ?? null),
    seen_release: /** @type {string | null} */ (row?.seen_release ?? null),
    hide_welcome: row?.hide_welcome === 1,
    default_shape: typeof row?.default_shape === "string" ? JSON.parse(row.default_shape) : null,
  };
}

/**
 * Saves the settings in `change` (only those; the column names come from
 * this fixed list, never from the request).
 * @param {D1Database} db
 * @param {string} userId
 * @param {import("./settings.js").SettingsChange} change
 */
export async function updateSettings(db, userId, change) {
  const columns = /** @type {const} */ (["top_label", "bottom_label", "theme", "seen_release", "hide_welcome", "default_shape"])
    .filter((c) => c in change);
  // hide_welcome is stored as 1 or 0, default_shape as JSON.
  const value = (/** @type {typeof columns[number]} */ c) => {
    const v = change[c];
    if (typeof v === "boolean") return Number(v);
    if (Array.isArray(v)) return JSON.stringify(v);
    return v ?? null;
  };
  await db.prepare(`UPDATE users SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .bind(...columns.map(value), userId).run();
}
