// Shared helpers for API and database tests.
import { SELF, env } from "cloudflare:test";
import { newToken, sha256Hex, isoAt } from "../src/auth/session.js";

export const ORIGIN = "http://localhost";

/** @type {Promise<{ id: string, cookie: string }> | undefined} */
let me;

/**
 * The user the tests act as, signed in with a session made directly in the
 * database (signing in with a passkey is tested in test/api/auth.test.js).
 * Made once per test file, as each file has its own database.
 */
export function signedInUser() {
  me ??= (async () => {
    const id = await createOtherUser();
    return { id, cookie: await sessionCookieFor(id) };
  })();
  return me;
}

/**
 * Starts a session for a user directly in the database.
 * @param {string} userId
 * @param {{ kind?: "full" | "recovery", createdAt?: string, lastUsedAt?: string, expiresAt?: string }} [options]
 * @returns {Promise<string>} the Cookie header to send
 */
export async function sessionCookieFor(userId, options = {}) {
  const token = newToken();
  const now = Date.now();
  await sql(
    `INSERT INTO sessions (id, token_hash, user_id, kind, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(), await sha256Hex(token), userId, options.kind ?? "full",
    options.createdAt ?? isoAt(now), options.lastUsedAt ?? isoAt(now),
    options.expiresAt ?? isoAt(now + 24 * 60 * 60 * 1000)
  ).run();
  return `__Host-session=${token}`;
}

/**
 * Calls the Worker as the signed-in test user (or with the given cookie; null
 * for none), from the app's own origin. Returns the status and parsed JSON body.
 * @param {string} path
 * @param {{ method?: string, body?: unknown, host?: string, cookie?: string | null, origin?: string | null }} [options]
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function call(path, { method = "GET", body, host = ORIGIN, cookie, origin = ORIGIN } = {}) {
  const sessionCookie = cookie === undefined ? (await signedInUser()).cookie : cookie;
  /** @type {Record<string, string>} */
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (sessionCookie) headers.cookie = sessionCookie;
  if (origin && method !== "GET") headers.origin = origin;
  const res = await SELF.fetch(host + path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/**
 * Creates something through the API and returns its id; fails the test if it
 * doesn't succeed.
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @returns {Promise<string>}
 */
export async function create(path, body) {
  const res = await call(path, { method: "POST", body });
  if (res.status !== 201) throw new Error(`POST ${path} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

/**
 * Inserts another user directly, for checking that users can't see or touch
 * each other's data.
 * @returns {Promise<string>} the user's id
 */
export async function createOtherUser() {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, email) VALUES (?, ?)").bind(id, id).run();
  return id;
}

/**
 * Runs one SQL statement directly against the test database.
 * @param {string} sql
 * @param {...unknown} params
 */
export function sql(sql, ...params) {
  return env.DB.prepare(sql).bind(...params);
}
