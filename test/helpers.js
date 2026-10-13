// Shared helpers for API and database tests.
import { SELF, env } from "cloudflare:test";

/**
 * Calls the Worker as the dev user (requests to localhost sign in as
 * DEV_USER_EMAIL). Returns the status and parsed JSON body.
 * @param {string} path
 * @param {{ method?: string, body?: unknown, host?: string }} [options]
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function call(path, { method = "GET", body, host = "http://localhost" } = {}) {
  const res = await SELF.fetch(host + path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
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
 * each other's data. Tests in the same file share a database, so the default
 * email is unique each time.
 * @param {string} [email]
 * @returns {Promise<string>} the user's id
 */
export async function createOtherUser(email = `other-${crypto.randomUUID()}@example.com`) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, email) VALUES (?, ?)").bind(id, email).run();
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
