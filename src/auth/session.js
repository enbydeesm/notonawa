// Sessions: random tokens and the rules for when one ends. Pure, so it's easy
// to test. Only a SHA-256 hash of each token is stored (see db.js), so a copy
// of the database can't be used to sign in.

export const SESSION_DAYS = 30; // the longest a session lasts
export const IDLE_DAYS = 7; // a session unused this long ends
export const RECOVERY_MINUTES = 15; // a session from a recovery code
export const TOUCH_AFTER_MINUTES = 60; // last_used_at is written at most this often, to save D1 writes
export const FRESH_MINUTES = 10; // "signed in recently", needed for sensitive changes

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * @typedef {"full" | "recovery"} SessionKind
 * @typedef {{
 *   id: string,
 *   user_id: string,
 *   kind: SessionKind,
 *   created_at: string,
 *   last_used_at: string,
 *   expires_at: string,
 * }} Session
 */

/** A new session token: 32 random bytes, base64url. */
export function newToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * @param {string} text
 * @returns {Promise<string>} lowercase hex
 */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A time as ISO text without milliseconds, like the database's NOW, so the
 * two compare correctly as strings.
 * @param {number} ms
 */
export function isoAt(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** @param {SessionKind} kind */
export function lifetimeMs(kind) {
  return kind === "recovery" ? RECOVERY_MINUTES * MINUTE : SESSION_DAYS * DAY;
}

/**
 * The cutoff for idle sessions: one last used at or before this has ended.
 * @param {number} [now]
 */
export function idleCutoff(now = Date.now()) {
  return isoAt(now - IDLE_DAYS * DAY);
}

/**
 * @param {Session} session
 * @param {number} [now]
 */
export function isActive(session, now = Date.now()) {
  if (session.expires_at <= isoAt(now)) return false;
  return session.kind === "recovery" || session.last_used_at > idleCutoff(now);
}

/**
 * @param {Session} session
 * @param {number} [now]
 */
export function needsTouch(session, now = Date.now()) {
  return session.last_used_at <= isoAt(now - TOUCH_AFTER_MINUTES * MINUTE);
}

/**
 * Signed in recently enough to add a passkey, remove one, or change the
 * recovery code, so a stolen session can't quietly take over the account.
 * A recovery session counts for its whole (short) life.
 * @param {Session} session
 * @param {number} [now]
 */
export function isFresh(session, now = Date.now()) {
  return session.kind === "recovery" || session.created_at > isoAt(now - FRESH_MINUTES * MINUTE);
}

/** @param {Uint8Array} bytes */
export function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
