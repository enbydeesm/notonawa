// Tag list logic for the "Edit tags" dialog. Pure (no DOM), so it's easy to test.

/** How many tags the dialog shows at once. */
export const SHOWN_TAGS = 15;

/** Same limits as the API (src/tags/parse.js). */
export const MAX_TAGS = 30;
export const MAX_TAG_LENGTH = 40;

/**
 * @typedef {{ id: string | null, name: string, tie_count: number, plan_count: number, workshop_count: number }} Tag
 * id is null for a tag typed in the dialog that's only created once the tie,
 * plan or workshop is saved.
 */

/**
 * What two names must share to count as the same tag, as on the server
 * (src/tags/parse.js): "Futomomo" and "futomomo" are one tag.
 * @param {string} name
 */
export function tagKey(name) {
  return name.toLocaleLowerCase();
}

/**
 * The tag with this name: an exact match, else one that differs only by capitals.
 * @template {{ name: string }} T
 * @param {T[]} tags
 * @param {string} name
 * @returns {T | undefined}
 */
export function findTag(tags, name) {
  return tags.find((t) => t.name === name) ?? tags.find((t) => tagKey(t.name) === tagKey(name));
}

/**
 * The tags to show for what's typed in the search box, keeping the list's order
 * (most recently used first).
 * @template {{ name: string }} T
 * @param {T[]} tags
 * @param {string} text
 * @param {number} [limit]
 * @returns {T[]}
 */
export function filterTags(tags, text, limit = SHOWN_TAGS) {
  const wanted = tagKey(text.trim());
  return tags.filter((t) => tagKey(t.name).includes(wanted)).slice(0, limit);
}

/**
 * The confirmation's extra line when deleting a tag that ties, plans or
 * workshops use.
 * @param {number} tieCount
 * @param {number} [planCount]
 * @param {number} [workshopCount]
 * @returns {string | undefined}
 */
export function deleteTagWarning(tieCount, planCount = 0, workshopCount = 0) {
  const uses = [count(tieCount, "tie", "ties"), count(planCount, "plan", "plans"), count(workshopCount, "workshop", "workshops")]
    .filter(Boolean);
  if (!uses.length) return undefined;
  const one = tieCount + planCount + workshopCount === 1;
  const list = uses.length > 1 ? `${uses.slice(0, -1).join(", ")} and ${uses[uses.length - 1]}` : uses[0];
  return `Used on ${list}; it'll be removed from ${one ? "it" : "them"}.`;
}

/**
 * "1 tie", "3 plans", or "" for none.
 * @param {number} n
 * @param {string} one
 * @param {string} many
 */
function count(n, one, many) {
  return n ? `${n} ${n === 1 ? one : many}` : "";
}
