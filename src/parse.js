// Field parsers: turn a submitted value into what we store, or throw BadInput.
// All pure, so they're easy to test.

import { BadInput } from "./http.js";

/** @param {unknown} value @returns {string | null} */
export function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

// An encrypted field as the browser seals it (public/js/crypto/fields.js;
// a unit test keeps the two in step): "e1.", a 12-byte IV, ".", and the
// ciphertext with its 16-byte tag, base64url.
/**
 * A version of the app, as scripts/releases-lib.mjs writes them: a deploy's
 * UTC date and time (2026.10.28.2104), or, in older ones, a release's
 * number that day (2026.10.19.001). The feedback form sends the page's,
 * and What's new saves the last one seen. Kept the same as releases-lib's
 * VERSION_FORMAT by a unit test.
 */
export const APP_VERSION_FORMAT = /^\d{4}\.\d{2}\.\d{2}\.(\d{3}|\d{4})$/;

const ENCRYPTED_FORMAT = /^e1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/;
export const MAX_ENCRYPTED_LENGTH = 100_000;

/**
 * A notes or description field: encrypted in the browser, or empty. Plain
 * text is refused, so nothing readable is ever saved in these fields.
 * @param {unknown} value
 * @returns {string | null}
 */
export function encryptedText(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_ENCRYPTED_LENGTH || !ENCRYPTED_FORMAT.test(value)) {
    throw new BadInput("Couldn't save the notes: they weren't encrypted. Reload the page and try again.");
  }
  return value;
}

/** @param {unknown} value @param {number} min @param {number} max @returns {number | null} */
export function toIntOrNull(value, min, max) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadInput(`Expected a whole number from ${min} to ${max}.`);
  }
  return n;
}

/** @param {unknown} value @param {number} min @param {number} max @returns {number | null} */
export function toNumberOrNull(value, min, max) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new BadInput(`Expected a number from ${min} to ${max}.`);
  }
  return n;
}

/** Checkbox-style values to 0/1. @param {unknown} value @returns {0 | 1} */
export function toFlag(value) {
  return value === true || value === 1 || value === "1" || value === "on" || value === "true" ? 1 : 0;
}

/** @param {unknown} value @param {readonly string[]} choices @returns {string | null} */
export function toChoiceOrNull(value, choices) {
  const text = cleanText(value);
  if (text === null) return null;
  if (!choices.includes(text)) throw new BadInput(`Expected one of: ${choices.join(", ")}.`);
  return text;
}

/**
 * Only http(s) links, so a stored link can never run script when clicked.
 * @param {unknown} value
 * @returns {string | null}
 */
export function toUrlOrNull(value) {
  const text = cleanText(value);
  if (text === null) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new BadInput("Expected a link starting with https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BadInput("Expected a link starting with https://");
  }
  return url.href;
}

/**
 * A plain calendar date, YYYY-MM-DD, that actually exists (no Feb 30).
 * @param {unknown} value
 * @returns {string | null}
 */
export function toDateOrNull(value) {
  const text = cleanText(value);
  if (text === null) return null;
  const m = text.match(/^(\d{4})-(\d\d)-(\d\d)$/);
  const date = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!date || date.toISOString().slice(0, 10) !== text) {
    throw new BadInput("Expected a date like 2026-10-12.");
  }
  return text;
}

/**
 * A timestamp in the app's format, e.g. 2026-10-11T21:51:00Z (see sql.js NOW),
 * that actually exists.
 * @param {unknown} value
 * @returns {string | null}
 */
export function toTimestampOrNull(value) {
  const text = cleanText(value);
  if (text === null) return null;
  // Date rejects an hour like 25 (NaN) but rolls Feb 30 over to March, so
  // both are checked.
  const time = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(text) ? new Date(text) : null;
  const valid = time !== null && !Number.isNaN(time.getTime()) &&
    time.toISOString().replace(/\.\d{3}Z$/, "Z") === text;
  if (!valid) throw new BadInput("Expected a time like 2026-10-12T21:51:00Z.");
  return text;
}
