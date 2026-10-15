// Parsing wrapped keys as the browser sends them. Pure, so it's easy to
// test. We can't check a wrap opens (only the user can); the browser checks
// that before sending it. Here we only check its shape.

import { BadInput } from "../http.js";

export const WRAP_VERSION = 1; // the same as public/js/crypto/keys.js

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const base64url = (/** @type {number} */ length) => new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
const SALT = base64url(22); // 16 bytes
const IV = base64url(16); // 12 bytes
const WRAPPED = base64url(64); // 48 bytes: a 32-byte key and a 16-byte tag

/**
 * @typedef {{ id: string, salt: string, iv: string, wrapped: string, version: number }} Wrap
 */

/**
 * @param {unknown} value
 * @param {"passkey" | "recovery"} kind the kind it must be
 * @returns {Wrap}
 */
export function parseWrap(value, kind) {
  const w = /** @type {Record<string, unknown>} */ (value);
  if (!w || typeof w !== "object" || w.kind !== kind
      || typeof w.id !== "string" || !UUID.test(w.id)
      || typeof w.salt !== "string" || !SALT.test(w.salt)
      || typeof w.iv !== "string" || !IV.test(w.iv)
      || typeof w.wrapped !== "string" || !WRAPPED.test(w.wrapped)
      || w.version !== WRAP_VERSION) {
    throw new BadInput("Couldn't save your encryption key. Please try again.");
  }
  return { id: w.id, salt: w.salt, iv: w.iv, wrapped: w.wrapped, version: w.version };
}

/**
 * A wrap that may be left out (null when it is).
 * @param {unknown} value
 * @param {"passkey" | "recovery"} kind
 * @returns {Wrap | null}
 */
export function parseOptionalWrap(value, kind) {
  return value === undefined || value === null ? null : parseWrap(value, kind);
}
