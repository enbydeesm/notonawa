// Parsing an import: the people, locations, plans and tags in it (one
// request), then its ties (in batches; see import-plan.js). Pure, so it's
// easy to test.
//
// The shape is the export's (shape.js); a CSV is turned into it by the page.
// Every field goes through the same parsers as the app's own forms. Ids in
// the file are only used to follow links within the file: rows always get new
// ids (import-plan.js), so a file can never touch or probe existing rows.

import { BadInput } from "../http.js";
import { cleanText, toIntOrNull, toFlag, toChoiceOrNull, toDateOrNull, toTimestampOrNull } from "../parse.js";
import { RESOURCES, parseFields } from "../resources/config.js";
import { ROLES } from "../ties/parse.js";
import { tagKey, MAX_TAG_LENGTH, parseTagNames } from "../tags/parse.js";

export const MAX_ITEMS = 5000; // of each kind, in one items request
export const MAX_TIES = 500; // in one ties request (the page sends 200)
export const PROFILE_NOTE_TYPES = ["injury", "modification", "like", "dislike", "limit"];
const MAX_LINKS = 20; // participants or plans on one tie, as in the tie form
const MAX_ID_LENGTH = 100;

/**
 * @typedef {{ created_at: string | null, updated_at: string | null }} Times
 * @typedef {Times & {
 *   type: string, description: string, noted_on: string | null, is_current: 0 | 1,
 * }} ProfileNoteInput
 * @typedef {Times & {
 *   file_id: string, name: string, pronouns: string | null, notes: string | null, is_self: 0 | 1,
 *   archived_at: string | null, profile_notes: ProfileNoteInput[],
 * }} PersonInput
 * @typedef {Times & {
 *   file_id: string, name: string, notes: string | null, hard_points: string | null,
 *   maps_url: string | null, latitude: number | null, longitude: number | null, archived_at: string | null,
 * }} LocationInput
 * @typedef {Times & {
 *   file_id: string, title: string, stage: string, description: string | null, notes: string | null,
 *   est_difficulty: number | null, variation_of: string | null, version: number,
 *   archived_at: string | null, tags: string[],
 * }} PlanInput
 * @typedef {{ people: PersonInput[], locations: LocationInput[], plans: PlanInput[], tags: string[] }} ItemsInput
 *
 * @typedef {{
 *   person_id: string | null, role: string, difficulty_rating: number | null,
 *   experience_rating: number | null, notes: string | null,
 * }} ImportParticipant
 * @typedef {{ plan_id: string | null, plan_version: number | null }} ImportTiePlan
 * @typedef {Times & {
 *   title: string | null, tie_date: string | null, notes: string | null,
 *   duration_minutes: number | null, success_rating: number | null,
 *   location_id: string | null, location_deleted: 0 | 1,
 *   participants: ImportParticipant[], plans: ImportTiePlan[], tags: string[],
 * }} TieImport
 */

/**
 * Body: { people, locations, plans, tags } as in the export (each optional).
 * @param {Record<string, unknown>} body
 * @returns {ItemsInput}
 */
export function parseImportItems(body) {
  const people = eachItem(body.people, "People", "name", parsePerson);
  if (people.filter((p) => p.is_self).length > 1) {
    throw new BadInput("Only one person can be marked as you.");
  }
  const plans = eachItem(body.plans, "Plans", "title", parsePlan);
  const planIds = new Set(plans.map((p) => p.file_id));
  for (const plan of plans) {
    if (plan.variation_of === plan.file_id) {
      throw new BadInput(`Plan "${plan.title}" can't be a variation of itself.`);
    }
    if (plan.variation_of !== null && !planIds.has(plan.variation_of)) {
      throw new BadInput(`Plan "${plan.title}" is a variation of a plan that isn't in the file.`);
    }
  }
  return {
    people,
    locations: eachItem(body.locations, "Locations", "name", parseLocation),
    plans,
    tags: parseTagList(body.tags, MAX_ITEMS),
  };
}

/**
 * Body: { ties: [...] } as in the export, with ids that are already mine
 * (the page swaps the file's ids for the ones the items request returned).
 * @param {Record<string, unknown>} body
 * @returns {TieImport[]}
 */
export function parseImportTies(body) {
  const list = body.ties;
  if (!Array.isArray(list) || list.length > MAX_TIES) {
    throw new BadInput(`Send ties as a list of up to ${MAX_TIES}.`);
  }
  return list.map((item, i) => withContext(`Tie ${i + 1}`, item?.title, () => parseTie(asObject(item))));
}

/** @param {Record<string, unknown>} t @returns {TieImport} */
function parseTie(t) {
  const locationId = parseId(t.location_id, true);
  const tie = {
    title: cleanText(t.title),
    tie_date: toDateOrNull(t.tie_date),
    notes: cleanText(t.notes),
    duration_minutes: toIntOrNull(t.duration_minutes, 0, 1440),
    success_rating: toIntOrNull(t.success_rating, 1, 5),
    location_id: locationId,
    // Only a tie without a location can show "(location deleted)" (a CHECK
    // on ties enforces the same).
    location_deleted: locationId === null ? toFlag(t.location_deleted) : /** @type {0} */ (0),
    created_at: toTimestampOrNull(t.created_at),
    updated_at: toTimestampOrNull(t.updated_at),
    participants: parseImportParticipants(t.participants),
    plans: parseImportTiePlans(t.plans),
    tags: parseTagNames(t.tags),
  };
  if (!tie.title && !tie.tie_date) throw new BadInput("Add at least a title or a date.");
  return tie;
}

/**
 * Like the tie form's participants, plus ratings and notes, and a null
 * person for "(person deleted)".
 * @param {unknown} value
 * @returns {ImportParticipant[]}
 */
function parseImportParticipants(value) {
  const seen = new Set();
  const result = [];
  for (const item of list(value, "Participants")) {
    const p = asObject(item);
    const personId = parseId(p.person_id, true);
    const role = toChoiceOrNull(p.role, ROLES);
    if (!role) throw new BadInput("Each participant needs a role.");
    if (personId !== null) {
      const key = `${personId}|${role}`;
      if (seen.has(key)) continue; // same person in the same role twice: keep one
      seen.add(key);
    }
    result.push({
      person_id: personId,
      role,
      difficulty_rating: toIntOrNull(p.difficulty_rating, 1, 5),
      experience_rating: toIntOrNull(p.experience_rating, 1, 5),
      notes: cleanText(p.notes),
    });
  }
  return result;
}

/**
 * A tie's plans, each with the version it used (null: the plan's current
 * version). A null plan is "(plan deleted)".
 * @param {unknown} value
 * @returns {ImportTiePlan[]}
 */
function parseImportTiePlans(value) {
  const seen = new Set();
  const result = [];
  for (const item of list(value, "Plans")) {
    const p = asObject(item);
    const planId = parseId(p.plan_id, true);
    if (planId !== null) {
      if (seen.has(planId)) continue;
      seen.add(planId);
    }
    result.push({ plan_id: planId, plan_version: toIntOrNull(p.plan_version, 1, 1_000_000) });
  }
  return result;
}

/** @param {Record<string, unknown>} p @returns {PersonInput} */
function parsePerson(p) {
  const { values } = parseFields(RESOURCES.people, p);
  const [name, pronouns, notes, isSelf] = /** @type {[string, string | null, string | null, 0 | 1]} */ (values);
  return {
    file_id: /** @type {string} */ (parseId(p.id)),
    name, pronouns, notes, is_self: isSelf,
    ...archiveAndTimes(p),
    profile_notes: list(p.profile_notes, "Profile notes", MAX_ITEMS).map((n) => parseProfileNote(asObject(n))),
  };
}

/** @param {Record<string, unknown>} n @returns {ProfileNoteInput} */
function parseProfileNote(n) {
  const type = toChoiceOrNull(n.type, PROFILE_NOTE_TYPES);
  const description = cleanText(n.description);
  if (!type || !description) throw new BadInput("Each profile note needs a type and a description.");
  return {
    type, description,
    noted_on: toDateOrNull(n.noted_on),
    // Current unless it says otherwise, as in the database.
    is_current: n.is_current === undefined || n.is_current === null ? 1 : toFlag(n.is_current),
    created_at: toTimestampOrNull(n.created_at),
    updated_at: toTimestampOrNull(n.updated_at),
  };
}

/** @param {Record<string, unknown>} l @returns {LocationInput} */
function parseLocation(l) {
  const { values } = parseFields(RESOURCES.locations, l);
  const [name, notes, hardPoints, mapsUrl, latitude, longitude] =
    /** @type {[string, string | null, string | null, string | null, number | null, number | null]} */ (values);
  return {
    file_id: /** @type {string} */ (parseId(l.id)),
    name, notes, hard_points: hardPoints, maps_url: mapsUrl, latitude, longitude,
    ...archiveAndTimes(l),
  };
}

/** @param {Record<string, unknown>} p @returns {PlanInput} */
function parsePlan(p) {
  const { values } = parseFields(RESOURCES.plans, p);
  const [title, stage, description, notes, estDifficulty] =
    /** @type {[string, string, string | null, string | null, number | null]} */ (values);
  return {
    file_id: /** @type {string} */ (parseId(p.id)),
    title, stage, description, notes, est_difficulty: estDifficulty,
    variation_of: parseId(p.variation_of, true),
    version: toIntOrNull(p.version, 1, 1_000_000) ?? 1,
    ...archiveAndTimes(p),
    tags: parseTagNames(p.tags),
  };
}

/** @param {Record<string, unknown>} item */
function archiveAndTimes(item) {
  return {
    archived_at: toTimestampOrNull(item.archived_at),
    created_at: toTimestampOrNull(item.created_at),
    updated_at: toTimestampOrNull(item.updated_at),
  };
}

/**
 * A list of tag names, longer than a tie's: the file's unused tags.
 * Trimmed, blanks dropped, kept once ignoring capitals.
 * @param {unknown} value
 * @param {number} max
 * @returns {string[]}
 */
export function parseTagList(value, max) {
  const seen = new Set();
  const names = [];
  for (const item of list(value, "Tags", max)) {
    const name = typeof item === "string" ? cleanText(item) : null;
    if (name === null) continue;
    if (name.length > MAX_TAG_LENGTH) throw new BadInput(`Keep tags to ${MAX_TAG_LENGTH} characters or fewer.`);
    if (seen.has(tagKey(name))) continue;
    seen.add(tagKey(name));
    names.push(name);
  }
  return names;
}

/**
 * Parses each item of a list, naming the item in any error, and checks each
 * file id is used once.
 * @template {{ file_id: string }} T
 * @param {unknown} value
 * @param {string} what e.g. "People"
 * @param {string} label the field that names an item, for errors
 * @param {(item: Record<string, unknown>) => T} parse
 * @returns {T[]}
 */
function eachItem(value, what, label, parse) {
  const ids = new Set();
  return list(value, what, MAX_ITEMS).map((item, i) => {
    const parsed = withContext(`${what} ${i + 1}`, item?.[label], () => parse(asObject(item)));
    if (ids.has(parsed.file_id)) throw new BadInput(`${what} ${i + 1}: the id ${parsed.file_id} is used twice.`);
    ids.add(parsed.file_id);
    return parsed;
  });
}

/**
 * Runs a parser, adding which item it was to any BadInput.
 * @template T
 * @param {string} where e.g. "Tie 3"
 * @param {unknown} name the item's title or name, if it has one
 * @param {() => T} parse
 * @returns {T}
 */
function withContext(where, name, parse) {
  try {
    return parse();
  } catch (err) {
    if (!(err instanceof BadInput)) throw err;
    const named = typeof name === "string" && name.trim() ? ` ("${name.trim().slice(0, 60)}")` : "";
    throw new BadInput(`${where}${named}: ${err.message}`);
  }
}

/**
 * @param {unknown} value
 * @param {string} what
 * @param {number} [max]
 * @returns {any[]}
 */
function list(value, what, max = MAX_LINKS) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) throw new BadInput(`${what} should be a list of up to ${max}.`);
  return value;
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadInput("Expected an object.");
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * An id: required unless nullable.
 * @param {unknown} value
 * @param {boolean} [nullable]
 * @returns {string | null}
 */
function parseId(value, nullable = false) {
  const id = typeof value === "string" || typeof value === "number" ? cleanText(value) : null;
  if (id === null) {
    if (nullable) return null;
    throw new BadInput("Each item needs an id.");
  }
  if (id.length > MAX_ID_LENGTH) throw new BadInput("That id is too long.");
  return id;
}
