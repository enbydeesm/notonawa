// Matching a keyword against a tie, on the device. Pure, so it's easy to
// test; the crypto Worker runs it over its search index (notes opened
// there, never sent to the page).
//
// toLocaleLowerCase on both sides, so capitals don't matter in any language
// ("Ö" finds "ö"; the server's LIKE only managed A–Z).

export const MAX_KEYWORD_LENGTH = 200;

/**
 * @typedef {{ id: string, title: string | null, notes: string | null, plan_titles: string[] }} IndexEntry
 *   notes opened
 */

/**
 * The keyword as it's matched: trimmed, lower case. null for no keyword.
 * @param {string} q
 * @returns {string | null}
 */
export function normaliseKeyword(q) {
  const text = q.trim().toLocaleLowerCase();
  return text === "" ? null : text;
}

/**
 * The ids of the ties whose title, notes or a linked plan's title contains
 * the keyword.
 * @param {IndexEntry[]} index
 * @param {string} q
 * @returns {string[]}
 */
export function matchingTies(index, q) {
  const keyword = normaliseKeyword(q);
  if (keyword === null) return index.map((entry) => entry.id);
  const has = (/** @type {string | null} */ text) => text !== null && text.toLocaleLowerCase().includes(keyword);
  return index.filter((entry) => has(entry.title) || has(entry.notes) || entry.plan_titles.some(has)).map((e) => e.id);
}
