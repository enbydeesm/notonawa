// Tag names: parsing and matching them to existing tags. Pure, so it's easy to test.

import { BadInput } from "../http.js";
import { cleanText } from "../parse.js";

export const MAX_TAGS = 30;
export const MAX_TAG_LENGTH = 40;

/**
 * What two names must share to count as the same tag: "Futomomo" and
 * "futomomo" are one tag. The page matches the same way (public/js/tags.js).
 * @param {string} name
 */
export function tagKey(name) {
  return name.toLocaleLowerCase();
}

/**
 * A tie's tags, as names. Trimmed, blanks dropped, and names that differ only
 * by capitals kept once (the first spelling).
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseTagNames(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TAGS) {
    throw new BadInput(`Tags should be a list of up to ${MAX_TAGS} tags.`);
  }
  const seen = new Set();
  const names = [];
  for (const item of value) {
    const name = typeof item === "string" ? cleanText(item) : null;
    if (name === null) continue;
    if (name.length > MAX_TAG_LENGTH) {
      throw new BadInput(`Keep tags to ${MAX_TAG_LENGTH} characters or fewer.`);
    }
    if (seen.has(tagKey(name))) continue;
    seen.add(tagKey(name));
    names.push(name);
  }
  return names;
}

/**
 * Matches each name to one of my existing tags, preferring an exact match,
 * then one that differs only by capitals. Names with no match are new tags.
 * @param {{ id: string, name: string }[]} existing
 * @param {string[]} names
 * @returns {{ name: string, isNew: boolean }[]} the name to link (the existing tag's spelling if there is one)
 */
export function matchTags(existing, names) {
  return names.map((name) => {
    const match = existing.find((t) => t.name === name) ??
      existing.find((t) => tagKey(t.name) === tagKey(name));
    return match ? { name: match.name, isNew: false } : { name, isNew: true };
  });
}
