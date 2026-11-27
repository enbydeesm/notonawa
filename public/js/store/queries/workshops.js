// Workshops as the Education view has them (format 2): the rows of format
// 1's GET /api/workshops (src/workshops/db.js), from the records in memory:
// the location's name, educators and participants (each with a link id,
// "w<n>", its place in the record, for the form to keep a deleted one),
// tags by name, the plans (A–Z) and ties (oldest first) linked to it, and
// its visuals counted. Newest first. Pure.

import { nocase } from "./resources.js";

/** @typedef {import("./resources.js").Entry} Entry */
/** @typedef {Map<string, Entry>} Journal */

/**
 * @param {string | null} a
 * @param {string | null} b
 */
function byName(a, b) {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return nocase(a, b);
}

/**
 * @param {Entry} workshop
 * @param {Journal} journal
 * @param {Entry[]} linkedItems the ties and plans whose workshop it is
 */
export function workshopRow(workshop, journal, linkedItems) {
  const b = workshop.body ?? {};
  /** @param {string | null | undefined} id @param {string} kind */
  const linked = (id, kind) => {
    const entry = id ? journal.get(id) : undefined;
    return entry && entry.kind === kind && entry.body ? entry : null;
  };
  const location = linked(b.location_id, "location");
  const visuals = Array.isArray(b.visuals) ? b.visuals : [];
  const people = (Array.isArray(b.people) ? b.people : []).map((/** @type {any} */ p, /** @type {number} */ i) => {
    const person = linked(p?.person_id, "person");
    return { kind: p?.kind, row: { id: `w${i}`, person_id: person ? person.id : null, person_name: person?.body?.name ?? null, is_self: person?.body?.is_self ? 1 : 0, role: p?.role ?? null } };
  });
  const plans = linkedItems.filter((i) => i.kind === "plan")
    .map((p) => ({ kind: "plan", id: p.id, title: p.body?.title ?? null, date: null }))
    .sort((x, y) => byName(x.title, y.title));
  const ties = linkedItems.filter((i) => i.kind === "tie")
    .sort((x, y) => {
      const a = `${x.body?.tie_date ?? ""}${x.body?.created_at ?? ""}`;
      const c = `${y.body?.tie_date ?? ""}${y.body?.created_at ?? ""}`;
      return a < c ? -1 : a > c ? 1 : 0;
    })
    .map((t) => ({ kind: "tie", id: t.id, title: t.body?.title ?? null, date: t.body?.tie_date ?? null }));
  return {
    id: workshop.id,
    title: b.title ?? "",
    start_date: b.start_date,
    end_date: b.end_date ?? null,
    attendee_count: b.attendee_count ?? null,
    rating: b.rating ?? null,
    difficulty: b.difficulty ?? null,
    rating_content: b.rating_content ?? null,
    rating_teaching: b.rating_teaching ?? null,
    rating_value: b.rating_value ?? null,
    cost: b.cost ?? null,
    event_url: b.event_url ?? null,
    description: b.description ?? null,
    notes: b.notes ?? null,
    album_url: b.album_url ?? null,
    created_at: b.created_at ?? null,
    updated_at: b.updated_at ?? null,
    location_id: location ? location.id : null,
    location_deleted: b.location_deleted || (b.location_id && !location) ? 1 : 0,
    location_name: location?.body?.name ?? null,
    photo_count: visuals.filter((/** @type {any} */ v) => v?.kind === "file").length,
    visual_count: visuals.length,
    educators: people.filter((/** @type {any} */ p) => p.kind === "educator").map((/** @type {any} */ p) => p.row),
    participants: people.filter((/** @type {any} */ p) => p.kind !== "educator").map((/** @type {any} */ p) => p.row),
    tags: (Array.isArray(b.tags) ? b.tags : []).flatMap((/** @type {string} */ t) => {
      const tag = linked(t, "tag");
      return tag ? [/** @type {string} */ (tag.body?.name)] : [];
    }).sort(nocase),
    linked: [...plans, ...ties],
  };
}

/**
 * All my workshops, newest first (by start date, then when logged, then id).
 * @param {Entry[]} workshops
 * @param {Entry[]} items every tie and plan
 * @param {Journal} journal
 */
export function listWorkshopsIn(workshops, items, journal) {
  /** @type {Map<string, Entry[]>} */
  const on = new Map();
  for (const item of items) {
    const w = item.body?.workshop_id;
    if (w) on.set(w, [...(on.get(w) ?? []), item]);
  }
  return [...workshops].sort((a, b) => {
    const x = [a.body?.start_date ?? "", a.body?.created_at ?? "", a.id];
    const y = [b.body?.start_date ?? "", b.body?.created_at ?? "", b.id];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? 1 : -1;
    return 0;
  }).map((w) => workshopRow(w, journal, on.get(w.id) ?? []));
}
