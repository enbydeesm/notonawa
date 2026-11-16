// Reading what a form sends into a record's fields (format 2): the device's
// copy of the server's field parsers (src/parse.js), with the same
// friendly messages, since for format 2 no server reads the fields. Pure.

import { ROLES } from "./schema.js";

/** Something the person typed can't be saved; the message says why. */
export class BadEdit extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "BadEdit";
  }
}

/**
 * Trimmed text, or null if empty.
 * @param {unknown} value
 * @returns {string | null}
 */
export function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * Text that's needed.
 * @param {unknown} value
 * @param {string} message what to say when it's empty
 */
export function requiredText(value, message) {
  const text = cleanText(value);
  if (text === null) throw new BadEdit(message);
  return text;
}

/**
 * A checkbox's value, as true or false.
 * @param {unknown} value
 */
export function flag(value) {
  return value === true || value === 1 || value === "1" || value === "on" || value === "true";
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {number | null}
 */
export function numberOrNull(value, min, max) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new BadEdit(`Expected a number from ${min} to ${max}.`);
  return n;
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {number | null}
 */
export function intOrNull(value, min, max) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadEdit(`Expected a whole number from ${min} to ${max}.`);
  return n;
}

/**
 * An http(s) link, so a stored link can never run script when clicked.
 * @param {unknown} value
 * @returns {string | null}
 */
export function urlOrNull(value) {
  const text = cleanText(value);
  if (text === null) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new BadEdit("Expected a link starting with https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BadEdit("Expected a link starting with https://");
  return url.href;
}

/**
 * A plain date, YYYY-MM-DD, that exists.
 * @param {unknown} value
 * @returns {string | null}
 */
export function dateOrNull(value) {
  const text = cleanText(value);
  if (text === null) return null;
  const m = text.match(/^(\d{4})-(\d\d)-(\d\d)$/);
  const date = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!date || date.toISOString().slice(0, 10) !== text) throw new BadEdit("Expected a date like 2026-10-12.");
  return text;
}

/**
 * A role, or null; the old "rigger" and "model" read as top and bottom.
 * @param {unknown} value
 * @param {readonly string[]} [roles]
 * @returns {string | null}
 */
export function roleOrNull(value, roles = ROLES) {
  const text = cleanText(value);
  return choiceOrNull(text === "rigger" ? "top" : text === "model" ? "bottom" : text, roles);
}

/**
 * A choice from a list, or null.
 * @param {unknown} value
 * @param {readonly string[]} choices
 * @returns {string | null}
 */
export function choiceOrNull(value, choices) {
  const text = cleanText(value);
  if (text === null) return null;
  if (!choices.includes(text)) throw new BadEdit(`Expected one of: ${choices.join(", ")}.`);
  return text;
}

/**
 * Now, as records keep times: 2026-11-14T12:00:00Z.
 * @param {Date} [date]
 */
export function stamp(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * A body without its empty fields: null, undefined, false is kept.
 * @param {Record<string, unknown>} body
 * @returns {Record<string, any>}
 */
export function compact(body) {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null && v !== undefined));
}
