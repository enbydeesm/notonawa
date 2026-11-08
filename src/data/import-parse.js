// Parsing an import: the people, locations, plans and tags in it (one
// request), then its ties and its workshops (in batches; see import-plan.js). Pure, so it's
// easy to test.
//
// The shape is the export's (shape.js); a CSV is turned into it by the page.
// Every field goes through the same parsers as the app's own forms: notes
// and descriptions must arrive encrypted (the page seals them). Ids in
// the file are only used to follow links within the file: rows always get new
// ids (import-plan.js), so a file can never touch or probe existing rows.

import { BadInput } from "../http.js";
import { cleanText, toIntOrNull, toFlag, toChoiceOrNull, toDateOrNull, toTimestampOrNull, encryptedText } from "../parse.js";
import { RESOURCES, parseFields } from "../resources/config.js";
import { TIE_TYPES, TYPE_NEEDED, toRoleOrNull, toWorkshopRoleOrNull } from "../ties/parse.js";
import { tagKey, MAX_TAG_LENGTH, parseTagNames } from "../tags/parse.js";
import { PEOPLE_KINDS, MAX_ATTENDEES } from "../workshops/parse.js";

export const MAX_ITEMS = 5000; // of each kind, in one items request
export const MAX_TIES = 500; // in one ties request (the page sends 200)
export const MAX_WORKSHOPS = 500; // in one workshops request (the page sends 200)
const MAX_WORKSHOP_PEOPLE = 40; // as in the workshop form
export const PROFILE_NOTE_TYPES = ["injury", "modification", "like", "dislike", "limit"];
const MAX_LINKS = 20; // participants or plans on one tie, as in the tie form
const MAX_LINKED = 2000; // ties or plans linked to one workshop
const MAX_ID_LENGTH = 100;

/**
 * @typedef {{ created_at: string | null, updated_at: string | null }} Times
 * @typedef {Times & {
 *   type: string, description: string, noted_on: string | null, is_current: 0 | 1,
 * }} ProfileNoteInput
 * @typedef {Times & {
 *   file_id: string, name: string, pronouns: string | null, notes: string | null, is_self: 0 | 1,
 *   default_role: string | null, is_educator: 0 | 1, based_in: string | null, aliases: string | null,
 *   about: string | null, about_shared_on: string | null, connection_id: string | null,
 *   archived_at: string | null, profile_notes: ProfileNoteInput[], always_new: boolean,
 * }} PersonInput
 * @typedef {Times & {
 *   file_id: string, name: string, notes: string | null,
 *   maps_url: string | null, city: string | null, state_province: string | null, country: string | null,
 *   latitude: number | null, longitude: number | null, is_default: 0 | 1,
 *   archived_at: string | null, always_new: boolean,
 * }} LocationInput
 * @typedef {Times & {
 *   file_id: string, title: string, stage: string, plan_type: string, tie_type: string | null,
 *   description: string | null, notes: string | null, album_url: string | null,
 *   est_difficulty: number | null, variation_of: string | null, version: number,
 *   archived_at: string | null, tags: string[], always_new: boolean,
 * }} PlanInput
 * @typedef {{ people: PersonInput[], locations: LocationInput[], plans: PlanInput[], tags: string[] }} ItemsInput
 *
 * @typedef {{
 *   person_id: string | null, role: string, difficulty_rating: number | null,
 *   experience_rating: number | null, notes: string | null,
 * }} ImportParticipant
 * @typedef {{ plan_id: string | null, plan_version: number | null }} ImportTiePlan
 * @typedef {Times & {
 *   title: string | null, tie_date: string, tie_type: string, notes: string | null, album_url: string | null,
 *   duration_minutes: number | null, success_rating: number | null,
 *   location_id: string | null, location_deleted: 0 | 1,
 *   participants: ImportParticipant[], plans: ImportTiePlan[], tags: string[],
 * }} TieImport
 *
 * @typedef {{ person_id: string | null, kind: string, role: string }} ImportWorkshopPerson
 * @typedef {Times & {
 *   title: string, start_date: string, end_date: string | null,
 *   location_id: string | null, location_deleted: 0 | 1,
 *   attendee_count: number | null, rating: number | null, difficulty: number | null,
 *   rating_content: number | null, rating_teaching: number | null, rating_value: number | null,
 *   cost: string | null, description: string | null, notes: string | null, album_url: string | null,
 *   people: ImportWorkshopPerson[], tags: string[], ties: string[], plans: string[],
 * }} WorkshopImport
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
    tie_type: toChoiceOrNull(t.tie_type, TIE_TYPES),
    notes: encryptedText(t.notes),
    album_url: encryptedText(t.album_url),
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
  const { tie_date: date, tie_type: type } = tie;
  if (!date) throw new BadInput("Add a date.");
  // Refused rather than guessed (migration 0014 filled in older ties).
  if (!type) throw new BadInput(TYPE_NEEDED);
  return { ...tie, tie_date: date, tie_type: type };
}

/**
 * Body: { workshops: [...] } as in the export, with ids that are already
 * mine (swapped by the page, as for ties).
 * @param {Record<string, unknown>} body
 * @returns {WorkshopImport[]}
 */
export function parseImportWorkshops(body) {
  const list = body.workshops;
  if (!Array.isArray(list) || list.length > MAX_WORKSHOPS) {
    throw new BadInput(`Send workshops as a list of up to ${MAX_WORKSHOPS}.`);
  }
  return list.map((item, i) => withContext(`Workshop ${i + 1}`, item?.title, () => parseWorkshop(asObject(item))));
}

/** @param {Record<string, unknown>} w @returns {WorkshopImport} */
function parseWorkshop(w) {
  const title = cleanText(w.title);
  if (!title) throw new BadInput("Add a title.");
  const start = toDateOrNull(w.start_date);
  if (!start) throw new BadInput("Add a start date.");
  let end = toDateOrNull(w.end_date);
  if (end !== null && end < start) throw new BadInput("The end date is before the start date.");
  if (end === start) end = null;
  const locationId = parseId(w.location_id, true);
  /** @type {ImportWorkshopPerson[]} */
  const people = [];
  const seen = new Set();
  for (const kind of PEOPLE_KINDS) {
    for (const item of list(w[`${kind}s`], kind === "educator" ? "Educators" : "Participants", MAX_WORKSHOP_PEOPLE)) {
      const p = asObject(item);
      const personId = parseId(p.person_id, true);
      const role = toWorkshopRoleOrNull(p.role);
      if (!role) throw new BadInput(`Each ${kind} needs a role.`);
      // The same person twice (a file edited by hand): kept once, as
      // whichever comes first. Deleted people (null) never clash.
      if (personId !== null) {
        if (seen.has(personId)) continue;
        seen.add(personId);
      }
      people.push({ person_id: personId, kind, role });
    }
  }
  if (people.length > MAX_WORKSHOP_PEOPLE) throw new BadInput(`A workshop can have up to ${MAX_WORKSHOP_PEOPLE} people.`);
  return {
    title,
    start_date: start,
    end_date: end,
    location_id: locationId,
    // As on ties: only a workshop without a location can show "(location deleted)".
    location_deleted: locationId === null ? toFlag(w.location_deleted) : /** @type {0} */ (0),
    attendee_count: toIntOrNull(w.attendee_count, 0, MAX_ATTENDEES),
    rating: toIntOrNull(w.rating, 1, 5),
    difficulty: toIntOrNull(w.difficulty, 1, 5),
    rating_content: toIntOrNull(w.rating_content, 1, 5),
    rating_teaching: toIntOrNull(w.rating_teaching, 1, 5),
    rating_value: toIntOrNull(w.rating_value, 1, 5),
    cost: encryptedText(w.cost),
    description: encryptedText(w.description),
    notes: encryptedText(w.notes),
    album_url: encryptedText(w.album_url),
    created_at: toTimestampOrNull(w.created_at),
    updated_at: toTimestampOrNull(w.updated_at),
    people,
    tags: parseTagNames(w.tags),
    // The ties and plans linked to it: already my ids (the page swaps them).
    ties: linkedIds(w.ties, "ties"),
    plans: linkedIds(w.plans, "plans"),
  };
}

/**
 * A workshop's linked ties or plans, by id.
 * @param {unknown} value
 * @param {string} what
 * @returns {string[]}
 */
function linkedIds(value, what) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_LINKED) throw new BadInput(`Its ${what} should be a list of up to ${MAX_LINKED}.`);
  return [...new Set(value.map((id) => /** @type {string} */ (parseId(id))))];
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
    const role = toRoleOrNull(p.role);
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
      notes: encryptedText(p.notes),
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
  const [name, pronouns, notes, isSelf, defaultRole, isEducator, basedIn, aliases, about, aboutSharedOn] =
    /** @type {[string, string | null, string | null, 0 | 1, string | null, 0 | 1, string | null, string | null, string | null, string | null]} */ (values);
  return {
    file_id: /** @type {string} */ (parseId(p.id)),
    name, pronouns, notes, is_self: isSelf, default_role: defaultRole,
    is_educator: isEducator, based_in: basedIn, aliases, about, about_shared_on: aboutSharedOn,
    // Checked against my connections when it's planned (import-plan.js).
    connection_id: parseId(p.connection_id, true),
    ...archiveAndTimes(p),
    profile_notes: list(p.profile_notes, "Profile notes", MAX_ITEMS).map((n) => parseProfileNote(asObject(n))),
    always_new: p.match === false,
  };
}

/** @param {Record<string, unknown>} n @returns {ProfileNoteInput} */
function parseProfileNote(n) {
  const type = toChoiceOrNull(n.type, PROFILE_NOTE_TYPES);
  const description = encryptedText(n.description);
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
  const [name, notes, mapsUrl, city, stateProvince, country, latitude, longitude, isDefault] =
    /** @type {[string, string | null, string | null, string | null, string | null, string | null, number | null, number | null, 0 | 1]} */ (values);
  return {
    file_id: /** @type {string} */ (parseId(l.id)),
    name, notes, maps_url: mapsUrl, city, state_province: stateProvince, country, latitude, longitude, is_default: isDefault,
    ...archiveAndTimes(l),
    always_new: l.match === false,
  };
}

/** @param {Record<string, unknown>} p @returns {PlanInput} */
function parsePlan(p) {
  const { values } = parseFields(RESOURCES.plans, p);
  const [title, stage, description, notes, estDifficulty, , planType, tieType, albumUrl] =
    /** @type {[string, string, string | null, string | null, number | null, unknown, string, string | null, string | null]} */ (values);
  return {
    file_id: /** @type {string} */ (parseId(p.id)),
    // Files from before migration 0011 have no plan_type: they're ideas.
    title, stage, plan_type: planType, tie_type: tieType, description, notes, album_url: albumUrl,
    est_difficulty: estDifficulty,
    variation_of: parseId(p.variation_of, true),
    version: toIntOrNull(p.version, 1, 1_000_000) ?? 1,
    ...archiveAndTimes(p),
    tags: parseTagNames(p.tags),
    always_new: p.match === false,
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
