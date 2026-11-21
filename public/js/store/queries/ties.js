// Ties as the pages have them (format 2), from the records in memory: the
// Ties search (format 1's POST /api/ties/search: src/ties/parse.js,
// search.js and db.js), one tie (GET /api/ties/:id), the tie form's recent
// pickers (GET /api/ties/recent/…), the keyword search's index and
// Analytics' ties (POST /api/stats/ties: src/stats/). The same filters,
// rows and order. Pure.

import { nocase } from "./resources.js";
import { BadEdit, cleanText, dateOrNull } from "../../records/parse.js";

/** @typedef {import("./resources.js").Entry} Entry */
/**
 * What the queries look things up in: every record by id.
 * @typedef {Map<string, Entry>} Journal
 * @typedef {{
 *   person_ids: string[], location_ids: string[], tag_ids: string[], tag_match: "any" | "all",
 *   person_match: "any" | "all", from: string | null, to: string | null, match_ids: string[] | null,
 *   page: number, page_size: number, sort: "newest" | "oldest",
 * }} TieFilters
 */

export const PAGE_SIZES = [20, 50, 100];
const MAX_FILTER_IDS = 50;

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {string[]}
 */
function idList(value, what) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadEdit(`Choose ${what} as a list.`);
  const ids = [...new Set(value.map(cleanText).filter((id) => id !== null))];
  if (ids.length > MAX_FILTER_IDS) throw new BadEdit(`Choose up to ${MAX_FILTER_IDS} ${what}.`);
  return /** @type {string[]} */ (ids);
}

/**
 * The Ties search's filters, read as the server reads them: people (all of
 * them on a tie), locations (any), tags (any, or all), dates (inclusive),
 * the ties a keyword matched, page, page size and sort.
 * @param {Record<string, any>} body as tie-search.js's searchBody makes it
 * @returns {TieFilters}
 */
export function readTieFilters(body) {
  const pageSize = body.page_size === undefined || body.page_size === null || body.page_size === "" ? 20 : Number(body.page_size);
  if (!PAGE_SIZES.includes(pageSize)) throw new BadEdit(`Show ${PAGE_SIZES.join(", ")} ties per page.`);
  const page = body.page === undefined || body.page === null || body.page === "" ? 1 : Number(body.page);
  if (!Number.isInteger(page) || page < 1) throw new BadEdit("Page should be a whole number, 1 or more.");
  const filters = {
    person_ids: idList(body.person_ids, "people"),
    location_ids: idList(body.location_ids, "locations"),
    tag_ids: idList(body.tag_ids, "tags"),
    tag_match: /** @type {"any" | "all"} */ (body.tag_match === "all" ? "all" : "any"),
    person_match: /** @type {"any" | "all"} */ ("all"),
    from: dateOrNull(body.from),
    to: dateOrNull(body.to),
    match_ids: Array.isArray(body.match_ids) ? body.match_ids : null,
    page,
    page_size: pageSize,
    sort: /** @type {"newest" | "oldest"} */ (body.sort === "oldest" ? "oldest" : "newest"),
  };
  if (filters.from && filters.to && filters.from > filters.to) throw new BadEdit("The start date is after the end date.");
  return filters;
}

/** @param {Entry} tie */
const peopleOn = (tie) => (Array.isArray(tie.body?.participants) ? tie.body.participants : []);
/** @param {Entry} tie */
const plansOn = (tie) => (Array.isArray(tie.body?.plans) ? tie.body.plans : []);
/** @param {Entry} tie */
const tagsOn = (tie) => (Array.isArray(tie.body?.tags) ? tie.body.tags : []);

/**
 * Whether a tie passes the filters (all of them; within one, as each says).
 * @param {Entry} tie
 * @param {Omit<TieFilters, "page" | "page_size" | "sort">} f
 */
export function tieMatches(tie, f) {
  const b = tie.body ?? {};
  if (f.person_ids.length) {
    const on = new Set(peopleOn(tie).map((/** @type {any} */ p) => p?.person_id));
    const ok = f.person_match === "any" ? f.person_ids.some((id) => on.has(id)) : f.person_ids.every((id) => on.has(id));
    if (!ok) return false;
  }
  if (f.location_ids.length && !f.location_ids.includes(b.location_id)) return false;
  if (f.tag_ids.length) {
    const on = new Set(tagsOn(tie));
    const ok = f.tag_match === "all" ? f.tag_ids.every((id) => on.has(id)) : f.tag_ids.some((id) => on.has(id));
    if (!ok) return false;
  }
  if (f.from && b.tie_date < f.from) return false;
  if (f.to && b.tie_date > f.to) return false;
  if (f.match_ids && !f.match_ids.includes(tie.id)) return false;
  return true;
}

/**
 * Newest tie first: by date, then when it was logged, then id, so the order
 * (and the page a tie lands on) never shifts.
 * @param {Entry} a
 * @param {Entry} b
 */
export function newestFirst(a, b) {
  const x = [a.body?.tie_date ?? "", a.body?.created_at ?? "", a.id];
  const y = [b.body?.tie_date ?? "", b.body?.created_at ?? "", b.id];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? 1 : -1;
  return 0;
}

/**
 * A name's order as SQLite sorts COLLATE NOCASE ascending: missing (null) first.
 * @param {string | null} a
 * @param {string | null} b
 */
function byName(a, b) {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return nocase(a, b);
}

/**
 * A tie as the Ties list, its form and its card have it: its location's and
 * workshop's names, its people and plans (deleted ones with no name), tags
 * by name, and its visuals counted. Each person's and plan's entry has a
 * link id ("p<n>", "l<n>": its place in the record), for the form to keep a
 * deleted one (records/edits.js's tieBody).
 * @param {Entry} tie
 * @param {Journal} journal
 */
export function tieRow(tie, journal) {
  const b = tie.body ?? {};
  /** @param {string | null | undefined} id @param {string} kind */
  const linked = (id, kind) => {
    const entry = id ? journal.get(id) : undefined;
    return entry && entry.kind === kind && entry.body ? entry : null;
  };
  const location = linked(b.location_id, "location");
  const workshop = linked(b.workshop_id, "workshop");
  const visuals = Array.isArray(b.visuals) ? b.visuals : [];
  return {
    id: tie.id,
    title: b.title ?? null,
    tie_date: b.tie_date,
    tie_type: b.tie_type,
    duration_minutes: b.duration_minutes ?? null,
    success_rating: b.success_rating ?? null,
    notes: b.notes ?? null,
    album_url: b.album_url ?? null,
    created_at: b.created_at ?? null,
    updated_at: b.updated_at ?? null,
    location_id: location ? location.id : null,
    location_deleted: b.location_deleted || (b.location_id && !location) ? 1 : 0,
    location_name: location?.body?.name ?? null,
    workshop_id: workshop ? workshop.id : null,
    workshop_title: workshop?.body?.title ?? null,
    photo_count: visuals.filter((/** @type {any} */ v) => v?.kind === "file").length,
    visual_count: visuals.length,
    participants: peopleOn(tie).map((/** @type {any} */ p, /** @type {number} */ i) => {
      const person = linked(p?.person_id, "person");
      return { id: `p${i}`, person_id: person ? person.id : null, person_name: person?.body?.name ?? null, is_self: person?.body?.is_self ? 1 : 0, role: p?.role };
    }),
    plans: plansOn(tie).map((/** @type {any} */ p, /** @type {number} */ i) => {
      const plan = linked(p?.plan_id, "plan");
      return { id: `l${i}`, plan_id: plan ? plan.id : null, plan_title: plan?.body?.title ?? null, plan_version: p?.plan_version ?? 1 };
    }).sort((x, y) => byName(x.plan_title, y.plan_title)),
    tags: tagsOn(tie).flatMap((/** @type {string} */ t) => {
      const tag = linked(t, "tag");
      return tag ? [/** @type {string} */ (tag.body?.name)] : [];
    }).sort(nocase),
  };
}

/**
 * One page of the ties that pass the filters, as POST /api/ties/search
 * gives it: { ties, total, all_total, page, page_size }.
 * @param {Entry[]} ties every tie
 * @param {Journal} journal
 * @param {TieFilters} filters
 */
export function findTiesIn(ties, journal, filters) {
  const found = ties.filter((t) => tieMatches(t, filters)).sort(newestFirst);
  if (filters.sort === "oldest") found.reverse();
  const start = (filters.page - 1) * filters.page_size;
  return {
    ties: found.slice(start, start + filters.page_size).map((t) => tieRow(t, journal)),
    total: found.length,
    all_total: ties.length,
    page: filters.page,
    page_size: filters.page_size,
  };
}

/**
 * What a keyword is searched in, for every tie: its title, notes and its
 * plans' titles (search-match.js's index).
 * @param {Entry[]} ties
 * @param {Journal} journal
 * @returns {import("../../search-match.js").IndexEntry[]}
 */
export function searchIndex(ties, journal) {
  return ties.map((t) => ({
    id: t.id,
    title: t.body?.title ?? null,
    notes: t.body?.notes ?? null,
    plan_titles: plansOn(t).flatMap((/** @type {any} */ p) => {
      const plan = p?.plan_id ? journal.get(p.plan_id) : undefined;
      return plan?.kind === "plan" && plan.body?.title ? [plan.body.title] : [];
    }),
  }));
}

/**
 * The ids of the active locations, people or plans most recently on a tie
 * (by its date, then when it was logged), for the tie form's pickers.
 * @param {"locations" | "people" | "plans"} kind
 * @param {Entry[]} ties
 * @param {Journal} journal
 * @param {number} [limit]
 * @returns {string[]}
 */
export function recentOn(kind, ties, journal, limit = 5) {
  const recordKind = { locations: "location", people: "person", plans: "plan" }[kind];
  /** @type {Map<string, { date: string, created: string }>} */
  const latest = new Map();
  for (const tie of ties) {
    const ids = kind === "locations" ? [tie.body?.location_id]
      : kind === "people" ? peopleOn(tie).map((/** @type {any} */ p) => p?.person_id)
      : plansOn(tie).map((/** @type {any} */ p) => p?.plan_id);
    for (const id of ids) {
      const item = id ? journal.get(id) : undefined;
      if (!item || item.kind !== recordKind || !item.body || item.body.archived_at) continue;
      const now = latest.get(id) ?? { date: "", created: "" };
      const date = tie.body?.tie_date ?? "";
      const created = tie.body?.created_at ?? "";
      latest.set(id, { date: date > now.date ? date : now.date, created: created > now.created ? created : now.created });
    }
  }
  return [...latest.entries()]
    .sort(([a, x], [b, y]) => (x.date !== y.date ? (x.date < y.date ? 1 : -1) : x.created !== y.created ? (x.created < y.created ? 1 : -1) : a < b ? -1 : 1))
    .slice(0, limit).map(([id]) => id);
}

/** The roles the Analytics filter offers, as src/stats/parse.js's ROLE_GROUPS. */
export const ROLE_GROUPS = /** @type {Record<string, string[]>} */ ({
  top: ["top"], bottom: ["bottom"], self_tie: ["self tie"], spotter: ["spotter"], photographer: ["photographer"],
});

/**
 * Analytics' ties, as POST /api/stats/ties gives them: in the dates, with
 * any of the chosen people, locations and tags, and (role) where "Me" took
 * part in that role; oldest first, with only what the counting needs.
 * @param {Entry[]} ties
 * @param {Journal} journal
 * @param {Record<string, any>} body { from, to, role, person_ids, location_ids, tag_ids }
 */
export function statsRows(ties, journal, body) {
  const base = readTieFilters({ person_ids: body.person_ids, location_ids: body.location_ids, tag_ids: body.tag_ids, from: body.from, to: body.to });
  const filters = { ...base, person_match: /** @type {const} */ ("any"), tag_match: /** @type {const} */ ("any") };
  const role = body.role;
  /** @type {string[] | null} */
  let roles = null;
  if (!(role === undefined || role === null || role === "" || role === "all")) {
    if (typeof role !== "string" || !Object.hasOwn(ROLE_GROUPS, role)) throw new BadEdit(`Choose a role: all, ${Object.keys(ROLE_GROUPS).join(", ")}.`);
    roles = ROLE_GROUPS[role];
  }
  /** @param {any} p */
  const personOf = (p) => {
    const person = p?.person_id ? journal.get(p.person_id) : undefined;
    return person?.kind === "person" && person.body ? person : null;
  };
  return ties
    .filter((t) => tieMatches(t, filters))
    .filter((t) => !roles || peopleOn(t).some((/** @type {any} */ p) => personOf(p)?.body?.is_self && /** @type {string[]} */ (roles).includes(p.role)))
    .sort((a, b) => {
      const x = a.body?.tie_date ?? "";
      const y = b.body?.tie_date ?? "";
      return x !== y ? (x < y ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((t) => {
      const b = t.body ?? {};
      const location = b.location_id ? journal.get(b.location_id) : undefined;
      const at = location?.kind === "location" && location.body ? location : null;
      return {
        id: t.id, tie_date: b.tie_date, tie_type: b.tie_type, duration_minutes: b.duration_minutes ?? null,
        success_rating: b.success_rating ?? null, location_id: at ? at.id : null,
        location_deleted: b.location_deleted || (b.location_id && !at) ? 1 : 0, location_name: at?.body?.name ?? null,
        latitude: at?.body?.latitude ?? null, longitude: at?.body?.longitude ?? null,
        participants: peopleOn(t).map((/** @type {any} */ p) => {
          const person = personOf(p);
          return { person_id: person ? person.id : null, person_name: person?.body?.name ?? null, is_self: !!person?.body?.is_self, role: p?.role };
        }),
      };
    });
}

