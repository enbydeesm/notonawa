// Field parsers: turn a submitted value into what we store, or throw BadInput.
// All pure, so they're easy to test.

import { BadInput } from "./http.js";

/** @param {unknown} value @returns {string | null} */
export function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
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
