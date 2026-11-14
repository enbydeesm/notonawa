// Edits to the journal's records (format 2): what a form's fields make of a
// record, and the changes that reach other records (one default location;
// a deleted person or location left on ties and workshops as "(… deleted)").
// The database enforced these for format 1; for format 2 the device does,
// with the whole journal in memory. Pure: each takes the records it needs
// and gives back the writes to save, all in one batch.

import {
  cleanText, requiredText, flag, numberOrNull, intOrNull, urlOrNull, dateOrNull, roleOrNull, choiceOrNull, compact, BadEdit,
} from "./parse.js";
import { PLAN_STAGES, PLAN_TYPES, TIE_TYPES } from "./schema.js";
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
  const visuals = Array.isArray(plan.body?.visuals) ? plan.body.visuals : [];
  return {
    writes,
    deletes: [
      ...visuals.filter((/** @type {any} */ v) => v?.kind === "drawing" || v?.kind === "pose")
        .map((/** @type {any} */ v) => ({ kind: v.kind, id: v.id })),
      { kind: "plan", id: plan.id, files: visuals.filter((/** @type {any} */ v) => v?.kind === "file").map((/** @type {any} */ v) => v.id) },
    ],
  };
}
