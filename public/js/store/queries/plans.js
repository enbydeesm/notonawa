// Plans as the pages have them (format 2): the rows of format 1's
// GET /api/plans (src/resources/config.js), from the records in memory:
// tags as names A–Z, the ties each is on newest first, its workshop's
// title and its visuals counted. Pure.

import { passesArchived, nocase } from "./resources.js";

/** @typedef {import("./resources.js").Entry} Entry */
/** @typedef {import("./resources.js").Archived} Archived */

/**
 * @param {Entry} entry
 * @param {{ tagNames: Map<string, string>, tiesOn: Map<string, Entry[]>, workshops: Map<string, Entry> }} context
 */
export function planRow({ id, body }, { tagNames, tiesOn, workshops }) {
  const b = body ?? {};
  const visuals = Array.isArray(b.visuals) ? b.visuals : [];
  const workshop = b.workshop_id ? workshops.get(b.workshop_id) : undefined;
  return {
    id,
    title: b.title ?? "",
    stage: b.stage ?? "idea",
    plan_type: b.plan_type ?? "idea",
    tie_type: b.tie_type ?? null,
    description: b.description ?? null,
    notes: b.notes ?? null,
    album_url: b.album_url ?? null,
    est_difficulty: b.est_difficulty ?? null,
    variation_of: b.variation_of ?? null,
    version: b.version ?? 1,
    archived_at: b.archived_at ?? null,
    created_at: b.created_at ?? null,
    updated_at: b.updated_at ?? null,
    workshop_id: b.workshop_id ?? null,
    workshop_title: workshop?.body?.title ?? null,
    photo_count: visuals.filter((/** @type {any} */ v) => v?.kind === "file").length,
    visual_count: visuals.length,
    tags: (Array.isArray(b.tags) ? b.tags : []).flatMap((/** @type {string} */ t) => tagNames.get(t) ?? []).sort(nocase),
    linked_ties: (tiesOn.get(id) ?? []).map((t) => ({
      id: t.id, title: t.body?.title ?? null, tie_date: t.body?.tie_date ?? null, success_rating: t.body?.success_rating ?? null,
    })),
  };
}

/**
 * Ties newest first: by tie date, then when they were logged.
 * @param {Entry} a
 * @param {Entry} b
 */
export function newestTie(a, b) {
  const x = `${a.body?.tie_date ?? ""}|${a.body?.created_at ?? ""}`;
  const y = `${b.body?.tie_date ?? ""}|${b.body?.created_at ?? ""}`;
  return x < y ? 1 : x > y ? -1 : 0;
}

/**
 * My plans, as GET /api/plans lists them: last changed first.
 * @param {{ plans: Entry[], ties: Entry[], tags: Entry[], workshops: Entry[] }} journal
 * @param {Archived} archived
 */
export function listPlans({ plans, ties, tags, workshops }, archived) {
  const tagNames = new Map(tags.map((t) => [t.id, /** @type {string} */ (t.body?.name)]));
  /** @type {Map<string, Entry[]>} */
  const tiesOn = new Map();
  for (const tie of [...ties].sort(newestTie)) {
    const ids = new Set((Array.isArray(tie.body?.plans) ? tie.body.plans : []).map((/** @type {any} */ p) => p?.plan_id).filter(Boolean));
    for (const planId of ids) tiesOn.set(planId, [...(tiesOn.get(planId) ?? []), tie]);
  }
  const context = { tagNames, tiesOn, workshops: new Map(workshops.map((w) => [w.id, w])) };
  return plans.map((p) => planRow(p, context)).filter((r) => passesArchived(r, archived))
    .sort((a, b) => (a.updated_at ?? "") < (b.updated_at ?? "") ? 1 : (a.updated_at ?? "") > (b.updated_at ?? "") ? -1 : 0);
}
