// Database queries for sign-in: challenges, invites, passkeys, sessions and
// recovery codes. Functions named ...Statement return a prepared statement
// for the caller to run in a batch with others.

import { NOW } from "../sql.js";
import { idleCutoff, isoAt, lifetimeMs, newToken, sha256Hex } from "./session.js";
import { TERMS_VERSION } from "./parse.js";

/** @typedef {import("./session.js").Session} Session */
/** @typedef {import("./session.js").SessionKind} SessionKind */

const CHALLENGE_MINUTES = 5;

/**
 * Stores a challenge we've issued, clearing out expired ones while we're here.
 * @param {D1Database} db
 * @param {{ challenge: string, purpose: "register" | "login", user_id?: string, new_user_id?: string, invite_hash?: string }} c
 */
export async function saveChallenge(db, c) {
  await db.batch([
    db.prepare(`DELETE FROM auth_challenges WHERE expires_at <= ${NOW}`),
    db.prepare(
      `INSERT INTO auth_challenges (challenge, purpose, user_id, new_user_id, invite_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(c.challenge, c.purpose, c.user_id ?? null, c.new_user_id ?? null, c.invite_hash ?? null,
      isoAt(Date.now() + CHALLENGE_MINUTES * 60 * 1000)),
  ]);
}

/**
 * Takes a challenge back, once: it's deleted, so it can't be replayed.
 * @param {D1Database} db
 * @param {string} challenge
 * @param {"register" | "login"} purpose
 * @returns {Promise<{ challenge: string, user_id: string | null, new_user_id: string | null, invite_hash: string | null } | null>}
 */
export function takeChallenge(db, challenge, purpose) {
  return db.prepare(
    `DELETE FROM auth_challenges WHERE challenge = ? AND purpose = ? AND expires_at > ${NOW}
     RETURNING challenge, user_id, new_user_id, invite_hash`
  ).bind(challenge, purpose).first();
}

/**
 * @param {D1Database} db
 * @param {string} codeHash
 */
export async function inviteIsUsable(db, codeHash) {
  const row = await db.prepare(
    `SELECT 1 FROM invites WHERE code_hash = ? AND used_at IS NULL
       AND (expires_at IS NULL OR expires_at > ${NOW})`
  ).bind(codeHash).first();
  return row !== null;
}

/**
 * @typedef {{
 *   id: string,
 *   public_key: string,
 *   counter: number,
 *   transports: string[] | undefined,
 *   name: string,
 *   prf_capable: 0 | 1 | null,
 * }} NewPasskey
 */

/**
 * @param {D1Database} db
 * @param {string} userId
 * @param {NewPasskey} p
 */
export function insertPasskeyStatement(db, userId, p) {
  return db.prepare(
    `INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, prf_capable)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(p.id, userId, p.public_key, p.counter, p.transports ? JSON.stringify(p.transports) : null, p.name, p.prf_capable);
}

/**
 * Creates a new user, using up their invite (the trigger on invites refuses
 * a used or expired one, which fails the whole batch).
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} inviteHash
 * @param {string} recoveryHash
 */
export function newUserStatements(db, userId, inviteHash, recoveryHash) {
  return [
    db.prepare(
      `INSERT INTO users (id, email, recovery_secret_hash, accepted_at, terms_version)
       VALUES (?, ?, ?, ${NOW}, ?)`
    ).bind(userId, userId, recoveryHash, TERMS_VERSION),
    db.prepare(`UPDATE invites SET used_at = ${NOW}, used_by = ? WHERE code_hash = ?`).bind(userId, inviteHash),
    // Every journal starts with its owner's own profile, renamable on the
    // People page, so ties can list "Me" from the first one.
    db.prepare("INSERT INTO people (id, owner_id, name, is_self) VALUES (?, ?, 'Me', 1)").bind(crypto.randomUUID(), userId),
  ];
}

/**
 * @param {D1Database} db
 * @param {string} userId
 * @returns {Promise<{ id: string, transports: string | null }[]>}
 */
export async function passkeyIds(db, userId) {
  const { results } = await db.prepare("SELECT id, transports FROM passkeys WHERE user_id = ?").bind(userId).all();
  return /** @type {any} */ (results);
}

/**
 * @param {D1Database} db
 * @param {string} id
 * @returns {Promise<{ id: string, user_id: string, public_key: string, counter: number, transports: string | null } | null>}
 */
export function findPasskey(db, id) {
  return db.prepare("SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = ?").bind(id).first();
}

/**
 * Records a passkey's use. prf: it gave PRF output just now, so it can
 * unlock (fills in prf_capable, which some browsers only report at sign-in).
 * Not giving it doesn't mark it unable: the same passkey may on another device.
 * @param {D1Database} db
 * @param {string} id
 * @param {number} counter
 * @param {boolean} prf
 */
export function usedPasskeyStatement(db, id, counter, prf) {
  return db.prepare(
    `UPDATE passkeys SET counter = ?, last_used_at = ${NOW}, prf_capable = CASE WHEN ? THEN 1 ELSE prf_capable END WHERE id = ?`
  ).bind(counter, prf ? 1 : 0, id);
}

/**
 * Statements that start a session (and tidy away the user's ended ones). Run
 * them in the caller's batch, then set the cookie with the token.
 * @param {D1Database} db
 * @param {string} userId
 * @param {{ kind: SessionKind, passkeyId: string | null }} options
 * @returns {Promise<{ token: string, statements: D1PreparedStatement[] }>}
 */
export async function newSessionStatements(db, userId, { kind, passkeyId }) {
  const token = newToken();
  const now = Date.now();
  return {
    token,
    statements: [
      db.prepare(
        `DELETE FROM sessions WHERE user_id = ?
           AND (expires_at <= ${NOW} OR (kind = 'full' AND last_used_at <= ?))`
      ).bind(userId, idleCutoff(now)),
      db.prepare(
        `INSERT INTO sessions (id, token_hash, user_id, passkey_id, kind, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), await sha256Hex(token), userId, passkeyId, kind, isoAt(now + lifetimeMs(kind))),
    ],
  };
}

/**
 * @param {D1Database} db
 * @param {string} tokenHash
 * @returns {Promise<Session | null>}
 */
export function findSession(db, tokenHash) {
  return db.prepare(
    "SELECT id, user_id, kind, passkey_id, created_at, last_used_at, expires_at FROM sessions WHERE token_hash = ?"
  ).bind(tokenHash).first();
}

/**
 * @param {D1Database} db
 * @param {string} id
 */
export function deleteSessionStatement(db, id) {
  return db.prepare("DELETE FROM sessions WHERE id = ?").bind(id);
}

/**
 * @param {D1Database} db
 * @param {string} id
 */
export async function touchSession(db, id) {
  await db.prepare(`UPDATE sessions SET last_used_at = ${NOW} WHERE id = ?`).bind(id).run();
}

/**
 * @param {D1Database} db
 * @param {string} recoveryHash
 * @returns {Promise<string | null>} the user's id
 */
export async function userWithRecovery(db, recoveryHash) {
  const row = await db.prepare("SELECT id FROM users WHERE recovery_secret_hash = ?").bind(recoveryHash)
    .first();
  return row ? /** @type {string} */ (row.id) : null;
}
