// Edits to the journal's records (format 2): what a form's fields make of a
// record, and the changes that reach other records (one default location;
// a deleted person or location left on ties and workshops as "(… deleted)").
// The database enforced these for format 1; for format 2 the device does,
// with the whole journal in memory. Pure: each takes the records it needs
// and gives back the writes to save, all in one batch.

import {
  cleanText, requiredText, flag, numberOrNull, intOrNull, urlOrNull, dateOrNull, roleOrNull, choiceOrNull, compact, BadEdit,
} from "./parse.js";
import { PLAN_STAGES, PLAN_TYPES, TIE_TYPES, WORKSHOP_ROLES } from "./schema.js";
import { readAliases } from "../aliases.js";

/**
 * A record, opened.
 * @typedef {{ kind: string, id: string, version?: number, body: Record<string, any> | null }} Entry
 * A write for the store: the record's new body, and the body it started from.
 * @typedef {{ kind: import("../crypto/records.js").RecordKind, id: string, body: Record<string, any>,
 *   from?: Record<string, any> }} Write
 */

export const SELF_KEPT = "Your own profile can't be deleted or archived. You can rename it.";
export const ARCHIVED_DEFAULT = "An archived location can't be the default. Restore it first.";

/**
 * A person's record from the People form's fields (as format 1's API takes
 * them). Fields the form doesn't have, and ones a newer version added, stay
 * as they were. Who is "me" is set only when the person is added; a new
 * one can be added already archived ("Add & archive" in a picker).
 * @param {Record<string, unknown>} fields
 * @param {Record<string, any> | null} prev the record's body now, or null for a new one
 * @param {string} now
 */
export function personBody(fields, prev, now) {
  const aliases = readAliases(cleanText(fields.aliases));
  const isSelf = prev ? prev.is_self : flag(fields.is_self);
  return compact({
    ...prev,
    name: requiredText(fields.name, "Give the person a name."),
    pronouns: cleanText(fields.pronouns),
    notes: cleanText(fields.notes),
    is_self: isSelf || null,
    default_role: roleOrNull(fields.default_role),
    is_educator: flag(fields.is_educator),
    based_in: cleanText(fields.based_in),
    aliases: aliases.length ? aliases : null,
    about: cleanText(fields.about),
    about_shared_on: dateOrNull(fields.about_shared_on),
    archived_at: prev ? prev.archived_at : (flag(fields.archive_now) && !isSelf ? now : null),
    created_at: prev?.created_at ?? now,
    updated_at: now,
  });
}

/**
 * A location's record from the Locations form's fields. An archived one
 * can't be the default; one added already archived (a one-off) isn't.
 * @param {Record<string, unknown>} fields
 * @param {Record<string, any> | null} prev
 * @param {string} now
 */
export function locationBody(fields, prev, now) {
  const archiveNow = !prev && flag(fields.archive_now);
  const archived = prev?.archived_at ?? (archiveNow ? now : null);
  const isDefault = flag(fields.is_default) && !archiveNow;
  if (isDefault && prev?.archived_at) throw new BadEdit(ARCHIVED_DEFAULT);
  return compact({
    ...prev,
    name: requiredText(fields.name, "Give the location a name."),
    notes: cleanText(fields.notes),
    maps_url: urlOrNull(fields.maps_url),
    city: cleanText(fields.city),
    state_province: cleanText(fields.state_province),
    country: cleanText(fields.country),
    latitude: numberOrNull(fields.latitude, -90, 90),
    longitude: numberOrNull(fields.longitude, -180, 180),
    is_default: isDefault,
    archived_at: archived,
    created_at: prev?.created_at ?? now,
    updated_at: now,
  });
}

/**
 * The writes that make one location the default: any other default stops
 * being one.
 * @param {Entry[]} locations every location
 * @param {string} id the new default's
 * @param {string} now
 * @returns {Write[]}
 */
export function clearOtherDefaults(locations, id, now) {
  return locations
    .filter((l) => l.id !== id && l.body?.is_default)
    .map((l) => ({ kind: "location", id: l.id, from: l.body ?? {}, body: { ...l.body, is_default: false, updated_at: now } }));
}

/**
 * Archiving: hidden from pickers and default lists. Archiving again keeps
 * the first date; an archived location stops being the default. "Me" can't
 * be archived.
 * @param {Entry} entry
 * @param {string} now
 * @returns {Write}
 */
export function archived(entry, now) {
  const body = /** @type {Record<string, any>} */ (entry.body);
  if (entry.kind === "person" && body.is_self) throw new BadEdit(SELF_KEPT);
  /** @type {Record<string, any>} */
  const next = { ...body, archived_at: body.archived_at ?? now, updated_at: now };
  if (entry.kind === "location") next.is_default = false;
  return { kind: /** @type {any} */ (entry.kind), id: entry.id, from: body, body: next };
}

/**
 * Restoring (not making a location the default again).
 * @param {Entry} entry
 * @param {string} now
 * @returns {Write}
 */
export function restored(entry, now) {
  const { archived_at: _gone, ...body } = /** @type {Record<string, any>} */ (entry.body);
  return { kind: /** @type {any} */ (entry.kind), id: entry.id, from: entry.body ?? {}, body: { ...body, updated_at: now } };
}

/**
 * Deleting a person: the ties and workshops they were on keep their place,
 * with no one in it ("(person deleted)"). "Me" can't be deleted.
 * @param {Entry} person
 * @param {Entry[]} items every tie and workshop
 * @param {string} now
 * @returns {Write[]} the ties and workshops changed
 */
export function personDeleted(person, items, now) {
  if (person.body?.is_self) throw new BadEdit(SELF_KEPT);
  return items.flatMap((item) => {
    const body = item.body;
    const listName = item.kind === "tie" ? "participants" : item.kind === "workshop" ? "people" : null;
    if (!body || !listName || !Array.isArray(body[listName])) return [];
    if (!body[listName].some((/** @type {any} */ p) => p?.person_id === person.id)) return [];
    const list = body[listName].map((/** @type {any} */ p) => (p?.person_id === person.id ? { ...p, person_id: null } : p));
    return [{ kind: /** @type {any} */ (item.kind), id: item.id, from: body, body: { ...body, [listName]: list, updated_at: now } }];
  });
}

/**
 * Deleting a location: its ties and workshops show "(location deleted)".
 * @param {Entry} location
 * @param {Entry[]} items every tie and workshop
 * @param {string} now
 * @returns {Write[]}
 */
export function locationDeleted(location, items, now) {
  return items.flatMap((item) => {
    const body = item.body;
    if (!body || (item.kind !== "tie" && item.kind !== "workshop") || body.location_id !== location.id) return [];
    const { location_id: _gone, ...rest } = body;
    return [{ kind: /** @type {any} */ (item.kind), id: item.id, from: body, body: { ...rest, location_deleted: true, updated_at: now } }];
  });
}

/**
 * A plan's record from the plan form's fields, with its tags' ids
 * (records/tags.js's linkTags). Its stage is set when it's added and left
 * alone after (no longer on the form); its visuals and anything else the
 * form hasn't stay as they were. A plan can be a variation of another of
 * mine, not of itself.
 * @param {Record<string, unknown>} fields
 * @param {Record<string, any> | null} prev
 * @param {{ id: string, tagIds: string[], plans: Entry[], now: string }} where
 */
export function planBody(fields, prev, { id, tagIds, plans, now }) {
  const variationOf = cleanText(fields.variation_of);
  if (variationOf === id) throw new BadEdit("A plan can't be a variation of itself.");
  if (variationOf && !plans.some((p) => p.id === variationOf)) throw new BadEdit("Linked item not found.");
  return compact({
    ...prev,
    title: requiredText(fields.title, "Give the plan a title."),
    stage: prev ? prev.stage : (choiceOrNull(fields.stage, PLAN_STAGES) ?? "idea"),
    description: cleanText(fields.description),
    notes: cleanText(fields.notes),
    est_difficulty: intOrNull(fields.est_difficulty, 1, 5),
    variation_of: variationOf,
    plan_type: choiceOrNull(fields.plan_type, PLAN_TYPES) ?? "idea",
    tie_type: choiceOrNull(fields.tie_type, TIE_TYPES),
    album_url: cleanText(fields.album_url),
    workshop_id: cleanText(fields.workshop_id),
    tags: tagIds.length ? tagIds : null,
    version: prev?.version ?? 1,
    archived_at: prev ? prev.archived_at : (flag(fields.archive_now) ? now : null),
    created_at: prev?.created_at ?? now,
    updated_at: now,
  });
}

/**
 * Deleting a plan: what else changes. Its ties lose it ("remove") or show
 * "(plan deleted)" ("keep"); plans that were variations of it stop being;
 * its drawings and poses go with it, and its photos' and videos' files are
 * freed.
 * @param {Entry} plan
 * @param {Entry[]} others every tie and plan
 * @param {"remove" | "keep"} linkedTies
 * @param {string} now
 * @returns {{ writes: Write[], deletes: { kind: any, id: string, files?: string[] }[] }}
 */
export function planDeleted(plan, others, linkedTies, now) {
  if (linkedTies !== "remove" && linkedTies !== "keep") throw new BadEdit("Say what to do with the plan's linked ties.");
  /** @type {Write[]} */
  const writes = [];
  for (const item of others) {
    const body = item.body;
    if (!body || item.id === plan.id) continue;
    if (item.kind === "tie" && Array.isArray(body.plans) && body.plans.some((/** @type {any} */ p) => p?.plan_id === plan.id)) {
      const plans = linkedTies === "remove"
        ? body.plans.filter((/** @type {any} */ p) => p?.plan_id !== plan.id)
        : body.plans.map((/** @type {any} */ p) => (p?.plan_id === plan.id ? { ...p, plan_id: null } : p));
      writes.push({ kind: "tie", id: item.id, from: body, body: { ...body, plans, updated_at: now } });
    }
    if (item.kind === "plan" && body.variation_of === plan.id) {
      const { variation_of: _gone, ...rest } = body;
      writes.push({ kind: "plan", id: item.id, from: body, body: { ...rest, updated_at: now } });
    }
  }
  return { writes, deletes: itemDeletes(plan) };
}

/**
 * The deletes for a tie, plan or workshop going for good: its drawings and
 * poses (records of their own), then the item, freeing its photos' and
 * videos' files.
 * @param {Entry} item
 * @returns {{ kind: any, id: string, files?: string[] }[]}
 */
export function itemDeletes(item) {
  const visuals = Array.isArray(item.body?.visuals) ? item.body.visuals : [];
  return [
    ...visuals.filter((/** @type {any} */ v) => v?.kind === "drawing" || v?.kind === "pose")
      .map((/** @type {any} */ v) => ({ kind: v.kind, id: v.id })),
    { kind: item.kind, id: item.id, files: visuals.filter((/** @type {any} */ v) => v?.kind === "file").map((/** @type {any} */ v) => v.id) },
  ];
}

/** What a tie without a type is told, as the server's (src/ties/parse.js). */
export const TYPE_NEEDED = "Choose a tie type: suspension, partial suspension, floor or hashira.";
const NOT_FOUND = "Linked item not found.";

/**
 * Links on a tie to people, plans or a location deleted since, which the
 * edit form shows as "(… deleted)": the ones it keeps, by the link ids its
 * rows had (store/queries/ties.js: "p<n>" and "l<n>", their place in the
 * record's lists).
 * @typedef {{ participants?: string[], plans?: string[], location?: boolean }} KeptDeleted
 */

/**
 * A tie's record from the tie form's fields (as format 1's API takes them),
 * with its tags' ids. Who took part and which plans are checked to be mine;
 * a person kept in the same role keeps their entry (and any ratings and
 * notes on it, which only an import sets); a plan kept keeps the version
 * recorded, an added one gets the plan's; deleted people, plans and
 * location stay only if the form keeps them. Its visuals and anything the
 * form hasn't stay as they were.
 * @param {Record<string, any>} fields
 * @param {Record<string, any> | null} prev
 * @param {{ tagIds: string[], has: (kind: string, id: string) => Entry | null, now: string }} where
 */
export function tieBody(fields, prev, { tagIds, has, now }) {
  const tieDate = dateOrNull(fields.tie_date);
  if (!tieDate) throw new BadEdit("Add a date.");
  const tieType = choiceOrNull(fields.tie_type, TIE_TYPES);
  if (!tieType) throw new BadEdit(TYPE_NEEDED);
  /** @type {KeptDeleted} */
  const keep = prev && fields.keep_deleted && typeof fields.keep_deleted === "object" ? fields.keep_deleted : {};
  const locationId = cleanText(fields.location_id);
  if (locationId && !has("location", locationId)) throw new BadEdit(NOT_FOUND);
  const workshopId = cleanText(fields.workshop_id);
  if (workshopId && !has("workshop", workshopId)) throw new BadEdit(NOT_FOUND);

  const prevPeople = Array.isArray(prev?.participants) ? prev.participants : [];
  const participants = [
    ...prevPeople.filter((/** @type {any} */ p, /** @type {number} */ i) => !p?.person_id && (keep.participants ?? []).includes(`p${i}`)),
    ...participantsOf(fields.participants).map(({ person_id, role }) => {
      if (!has("person", person_id)) throw new BadEdit(NOT_FOUND);
      return prevPeople.find((/** @type {any} */ p) => p?.person_id === person_id && p?.role === role) ?? { person_id, role };
    }),
  ];
  const prevPlans = Array.isArray(prev?.plans) ? prev.plans : [];
  const plans = [
    ...prevPlans.filter((/** @type {any} */ p, /** @type {number} */ i) => !p?.plan_id && (keep.plans ?? []).includes(`l${i}`)),
    ...planIdsOf(fields.plan_ids).map((planId) => {
      const plan = has("plan", planId);
      if (!plan) throw new BadEdit(NOT_FOUND);
      return prevPlans.find((/** @type {any} */ p) => p?.plan_id === planId) ?? { plan_id: planId, plan_version: plan.body?.version ?? 1 };
    }),
  ];
  const { location_deleted: wasDeleted, ...rest } = prev ?? {};
  return compact({
    ...rest,
    title: cleanText(fields.title),
    tie_date: tieDate,
    tie_type: tieType,
    notes: cleanText(fields.notes),
    album_url: cleanText(fields.album_url),
    duration_minutes: intOrNull(fields.duration_minutes, 0, 1440),
    success_rating: intOrNull(fields.success_rating, 1, 5),
    location_id: locationId,
    location_deleted: !locationId && wasDeleted && keep.location === true ? true : null,
    workshop_id: workshopId,
    participants: participants.length ? participants : null,
    plans: plans.length ? plans : null,
    tags: tagIds.length ? tagIds : null,
    created_at: prev?.created_at ?? now,
    updated_at: now,
  });
}

/**
 * A tie's people from the form: each a person and a role, up to 20, the
 * same person in the same role once. As src/ties/parse.js.
 * @param {unknown} value
 * @returns {{ person_id: string, role: string }[]}
 */
export function participantsOf(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new BadEdit("Participants should be a list of up to 20 people.");
  const seen = new Set();
  /** @type {{ person_id: string, role: string }[]} */
  const result = [];
  for (const item of value) {
    const personId = cleanText(item?.person_id);
    const role = roleOrNull(item?.role);
    if (!personId || !role) throw new BadEdit("Each participant needs a person and a role.");
    if (seen.has(`${personId}|${role}`)) continue;
    seen.add(`${personId}|${role}`);
    result.push({ person_id: personId, role });
  }
  return result;
}

/**
 * A tie's plans from the form: up to 20 ids, each once.
 * @param {unknown} value
 * @returns {string[]}
 */
export function planIdsOf(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new BadEdit("Plans should be a list of up to 20 plans.");
  return [...new Set(value.map(cleanText).filter((id) => id !== null))];
}

/**
 * A workshop's record from its form's fields (as format 1's API takes
 * them), with its tags' ids. Educators and participants are one list, each
 * person once; deleted people and a deleted location stay only if the form
 * keeps them (by the link ids its rows had: "w<n>", their place in the
 * record's list). Its visuals and anything the form hasn't stay as they
 * were.
 * @param {Record<string, any>} fields
 * @param {Record<string, any> | null} prev
 * @param {{ tagIds: string[], has: (kind: string, id: string) => Entry | null, now: string }} where
 */
export function workshopBody(fields, prev, { tagIds, has, now }) {
  const title = cleanText(fields.title);
  if (!title) throw new BadEdit("Add a title.");
  if (title.length > 200) throw new BadEdit("Keep the title to 200 characters.");
  const start = dateOrNull(fields.start_date);
  if (!start) throw new BadEdit("Add a start date.");
  let end = dateOrNull(fields.end_date);
  if (end !== null && end < start) throw new BadEdit("The end date is before the start date.");
  if (end === start) end = null; // one day: no end date
  let attendees;
  try {
    attendees = intOrNull(fields.attendee_count, 0, 100_000);
  } catch {
    throw new BadEdit("The attendee count should be a whole number, 0 or more.");
  }
  const locationId = cleanText(fields.location_id);
  if (locationId && !has("location", locationId)) throw new BadEdit(NOT_FOUND);
  /** @type {{ people?: string[], location?: boolean }} */
  const keep = prev && fields.keep_deleted && typeof fields.keep_deleted === "object" ? fields.keep_deleted : {};
  const prevPeople = Array.isArray(prev?.people) ? prev.people : [];
  const people = [
    ...prevPeople.filter((/** @type {any} */ p, /** @type {number} */ i) => !p?.person_id && (keep.people ?? []).includes(`w${i}`)),
    ...workshopPeopleOf(fields.educators, fields.participants).map((p) => {
      if (!has("person", p.person_id)) throw new BadEdit(NOT_FOUND);
      return p;
    }),
  ];
  const { location_deleted: wasDeleted, ...rest } = prev ?? {};
  return compact({
    ...rest,
    title,
    start_date: start,
    end_date: end,
    location_id: locationId,
    location_deleted: !locationId && wasDeleted && keep.location === true ? true : null,
    attendee_count: attendees,
    rating: intOrNull(fields.rating, 1, 5),
    difficulty: intOrNull(fields.difficulty, 1, 5),
    rating_content: intOrNull(fields.rating_content, 1, 5),
    rating_teaching: intOrNull(fields.rating_teaching, 1, 5),
    rating_value: intOrNull(fields.rating_value, 1, 5),
    cost: cleanText(fields.cost),
    event_url: cleanText(fields.event_url),
    description: cleanText(fields.description),
    notes: cleanText(fields.notes),
    album_url: cleanText(fields.album_url),
    people: people.length ? people : null,
    tags: tagIds.length ? tagIds : null,
    created_at: prev?.created_at ?? now,
    updated_at: now,
  });
}

/**
 * A workshop's educators and participants as one list, each with its kind:
 * up to 40, a person once (an educator or a participant, not both). As
 * src/workshops/parse.js.
 * @param {unknown} educators
 * @param {unknown} participants
 * @returns {{ person_id: string, kind: string, role: string }[]}
 */
export function workshopPeopleOf(educators, participants) {
  /** @param {unknown} value @param {string} kind */
  const list = (value, kind) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new BadEdit(`The ${kind}s should be a list.`);
    return value.map((item) => {
      const personId = cleanText(item?.person_id);
      const role = roleOrNull(item?.role, WORKSHOP_ROLES);
      if (!personId || !role) throw new BadEdit(`Each ${kind} needs a person and a role.`);
      return { person_id: personId, kind, role };
    });
  };
  const rows = [...list(educators, "educator"), ...list(participants, "participant")];
  if (rows.length > 40) throw new BadEdit("A workshop can have up to 40 people.");
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.person_id)) throw new BadEdit("Someone is on the workshop twice. Each person can be an educator or a participant, not both.");
    seen.add(row.person_id);
  }
  return rows;
}

/**
 * Deleting a workshop: its ties and plans are unlinked, and its drawings,
 * poses and files go with it.
 * @param {Entry} workshop
 * @param {Entry[]} items every tie and plan
 * @param {string} now
 */
export function workshopDeleted(workshop, items, now) {
  /** @type {Write[]} */
  const writes = items.flatMap((item) => {
    if (!item.body || item.body.workshop_id !== workshop.id) return [];
    const { workshop_id: _gone, ...rest } = item.body;
    return [{ kind: /** @type {any} */ (item.kind), id: item.id, from: item.body, body: { ...rest, updated_at: now } }];
  });
  return { writes, deletes: itemDeletes(workshop) };
}

/**
 * Linking a tie or plan to a workshop: it has one at most, so this moves it
 * from any other.
 * @param {Entry} item
 * @param {string} workshopId
 * @param {string} now
 * @returns {Write}
 */
export function linkedToWorkshop(item, workshopId, now) {
  const body = /** @type {Record<string, any>} */ (item.body);
  return { kind: /** @type {any} */ (item.kind), id: item.id, from: body, body: { ...body, workshop_id: workshopId, updated_at: now } };
}
