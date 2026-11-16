// Tags as the pages have them (format 2): GET /api/tags's rows, from the
// records in memory. Most recently used on a tie first (by the newest tie
// each is on: tie date, then when it was logged); tags on no tie last, by
// name. Pure.

import { nocase } from "./resources.js";

/** @typedef {import("./resources.js").Entry} Entry */

/**
 * @param {{ tags: Entry[], ties: Entry[], plans: Entry[], workshops: Entry[] }} journal
 * @returns {{ id: string, name: string, tie_count: number, plan_count: number, workshop_count: number }[]}
 */
export function listTags({ tags, ties, plans, workshops }) {
  /** @param {Entry[]} items */
  const counts = (items) => {
    /** @type {Map<string, number>} */
    const n = new Map();
    for (const item of items) for (const t of new Set(Array.isArray(item.body?.tags) ? item.body.tags : [])) n.set(t, (n.get(t) ?? 0) + 1);
    return n;
  };
  const tieCounts = counts(ties);
  const planCounts = counts(plans);
  const workshopCounts = counts(workshops);
  /** @type {Map<string, string>} */
  const newest = new Map();
  for (const tie of ties) {
    const when = `${tie.body?.tie_date ?? ""}|${tie.body?.created_at ?? ""}`;
    for (const t of Array.isArray(tie.body?.tags) ? tie.body.tags : []) {
      if (!newest.has(t) || /** @type {string} */ (newest.get(t)) < when) newest.set(t, when);
    }
  }
  return tags.map((t) => ({
    id: t.id, name: /** @type {string} */ (t.body?.name ?? ""),
    tie_count: tieCounts.get(t.id) ?? 0, plan_count: planCounts.get(t.id) ?? 0, workshop_count: workshopCounts.get(t.id) ?? 0,
  })).sort((a, b) => {
    const x = newest.get(a.id);
    const y = newest.get(b.id);
    if (x && y && x !== y) return x < y ? 1 : -1;
    if (!!x !== !!y) return x ? -1 : 1;
    return nocase(a.name, b.name);
  });
}
