// What the Plans view shows and filters: a plan's type as words, how many
// ties it's on and their average rating, and the search (keyword, plan
// types, tie types, tags). Pure (no DOM), so it's easy to test.
//
// The search runs over the plans already on the page (they're all loaded,
// their notes opened), so nothing typed goes to the server. It isn't kept
// in the address either: it starts empty each time Plans is shown.

import { normaliseKeyword } from "./search-match.js";

/** A plan's type, as the page shows it (src/resources/config.js has the list). @type {Record<string, string>} */
export const PLAN_TYPE_NAMES = { idea: "Idea", harness: "Harness", sequence: "Sequence" };

/**
 * A plan card's second line: its tie type and plan type, "Hashira
 * sequence" (just "Sequence" without a tie type), and, for a variation,
 * what of: "Floor harness · variation of Gote".
 * @param {{ tie_type?: string | null, plan_type?: string | null }} plan
 * @param {string | null} [variationOf] the plan it's a variation of: its title, or "" if it's gone
 * @returns {string}
 */
export function planKindText(plan, variationOf = null) {
  const type = (PLAN_TYPE_NAMES[/** @type {keyof typeof PLAN_TYPE_NAMES} */ (plan.plan_type)] ?? plan.plan_type ?? "").toLowerCase();
  const kind = [plan.tie_type, type].filter(Boolean).join(" ");
  const text = kind.charAt(0).toUpperCase() + kind.slice(1);
  if (variationOf === null) return text;
  return [text, `variation of ${variationOf || "another plan"}`].filter(Boolean).join(" · ");
}

/**
 * @typedef {{ id: string, title: string | null, tie_date: string, success_rating: number | null }} LinkedTie
 * @typedef {{
 *   q: string,
 *   plan_types: string[],
 *   tie_types: string[],
 *   tags: string[],
 *   tag_match: "any" | "all",
 * }} PlanSearch
 *   tags: names (a plan lists its tags by name)
 */

/** @type {PlanSearch} */
export const EMPTY_SEARCH = { q: "", plan_types: [], tie_types: [], tags: [], tag_match: "any" };

/**
 * How many ties a plan is on, and the average of their ratings (to one
 * decimal place; null if none of them is rated).
 * @param {LinkedTie[]} ties
 * @returns {{ count: number, average: number | null }}
 */
export function tieSummary(ties) {
  const ratings = ties.map((t) => t.success_rating).filter((r) => typeof r === "number");
  const average = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;
  return { count: ties.length, average };
}

/**
 * "1 tie", "3 ties".
 * @param {number} count
 */
export function tieCountText(count) {
  return count === 1 ? "1 tie" : `${count} ties`;
}

/**
 * Whether anything narrows the list.
 * @param {PlanSearch} search
 */
export function hasPlanFilters(search) {
  return normaliseKeyword(search.q) !== null || search.plan_types.length > 0 ||
    search.tie_types.length > 0 || search.tags.length > 0;
}

/**
 * The plans the search finds, in the order given. The keyword is looked
 * for in the title, description and notes (opened); a plan matches the
 * types if it's one of those chosen, and the tags if it has any (or all)
 * of them, ignoring capitals.
 * @template {Record<string, any>} P
 * @param {P[]} plans as GET /api/plans lists them (title, plan_type,
 *   tie_type, tags), their description and notes opened
 * @param {PlanSearch} search
 * @returns {P[]}
 */
export function filterPlans(plans, search) {
  const keyword = normaliseKeyword(search.q);
  const wanted = search.tags.map((name) => name.toLocaleLowerCase());
  const has = (/** @type {string | null | undefined} */ text) => !!text && text.toLocaleLowerCase().includes(/** @type {string} */ (keyword));
  return plans.filter((plan) => {
    if (keyword !== null && !has(plan.title) && !has(plan.description) && !has(plan.notes)) return false;
    if (search.plan_types.length && !search.plan_types.includes(plan.plan_type)) return false;
    if (search.tie_types.length && !(plan.tie_type && search.tie_types.includes(plan.tie_type))) return false;
    if (wanted.length) {
      const mine = /** @type {string[]} */ (plan.tags ?? []).map((name) => name.toLocaleLowerCase());
      const found = wanted.filter((name) => mine.includes(name)).length;
      if (search.tag_match === "all" ? found < wanted.length : found === 0) return false;
    }
    return true;
  });
}

/**
 * The plans that are variations of one, for its form's "Variations": the
 * most recently updated first (then by title), archived ones included.
 * @template {Record<string, any>} P
 * @param {P[]} plans every plan, archived ones too (id, title, variation_of, updated_at)
 * @param {string | null} id the plan's; none for a new plan
 * @returns {P[]}
 */
export function variationsOf(plans, id) {
  if (!id) return [];
  return plans.filter((p) => p.variation_of === id && p.id !== id)
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || (a.title ?? "").localeCompare(b.title ?? ""));
}
