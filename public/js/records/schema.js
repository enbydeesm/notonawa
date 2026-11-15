// What each kind of record (format 2) holds, and the checks on one record
// on its own: the rules the server's parsers and the database's CHECKs
// enforce today, which the device must keep once the server can't read
// records. Pure, so it's easy to test.
//
// Rules across records (one "this is me", one default location, deleted
// links shown as deleted, a tie or plan on one workshop) need the whole
// journal, so they're records/edits.js's, with the cache.
//
// A record's links are ids inside it: a tie's people, plans, tags,
// location and workshop; its visuals, in order, are one list of
// { kind, id }, a file's entry holding its key and caption too. An id of
// null is a link whose item was deleted ("(person deleted)" and so on).
//
// Fields a record has that its kind doesn't list are kept, not refused: a
// device that hasn't reloaded into a newer version mustn't lose them when
// it edits the record.

import { RECORD_KINDS } from "../crypto/records.js";

/** @typedef {import("../crypto/records.js").RecordKind} RecordKind */
/** @typedef {(value: unknown, path: string) => string | null} Check what's wrong, or null */

export const ROLES = ["top", "bottom", "self tie", "spotter", "photographer"];
export const WORKSHOP_ROLES = [...ROLES, "audit"];
export const TIE_TYPES = ["suspension", "partial suspension", "floor", "hashira"];
export const PLAN_TYPES = ["idea", "harness", "sequence"];
export const PLAN_STAGES = ["idea", "developing", "ready", "retired"];
export const PROFILE_NOTE_TYPES = ["injury", "modification", "like", "dislike", "limit"];
export const ALIAS_PLATFORMS = ["scene", "fetlife", "instagram", "x", "bluesky", "other"];
export const VISUAL_KINDS = ["file", "drawing", "pose"];

/** Limits, as today's. */
export const LIMITS = Object.freeze({
  title: 200, shortText: 200, longText: 50_000, caption: 1000, tagName: 40, roleName: 24,
  participants: 20, plans: 20, tags: 30, workshopPeople: 40, attendees: 100_000, minutes: 1440,
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;

// Each check passes null and undefined (an empty field) unless it's
// wrapped in required().

/** @param {number} max @returns {Check} */
const text = (max) => (v, p) => v == null ? null
  : typeof v !== "string" ? `${p} should be text`
  : v.length > max ? `${p} is longer than ${max} characters`
  : null;
/** @param {number} min @param {number} max @returns {Check} */
const int = (min, max) => (v, p) => v == null ? null
  : Number.isInteger(v) && /** @type {number} */ (v) >= min && /** @type {number} */ (v) <= max ? null : `${p} should be a whole number from ${min} to ${max}`;
/** @param {number} min @param {number} max @returns {Check} */
const number = (min, max) => (v, p) => v == null ? null
  : typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? null : `${p} should be a number from ${min} to ${max}`;
/** @param {readonly string[]} list @returns {Check} */
const oneOf = (list) => (v, p) => v == null || list.includes(/** @type {string} */ (v)) ? null : `${p} should be one of ${list.join(", ")}`;
/** @type {Check} */
const bool = (v, p) => v == null || typeof v === "boolean" ? null : `${p} should be true or false`;
/** @type {Check} */
const date = (v, p) => v == null || (typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v))) ? null : `${p} should be a date`;
/** @type {Check} */
const timestamp = (v, p) => v == null || (typeof v === "string" && TIMESTAMP.test(v)) ? null : `${p} should be a time`;
/** @type {Check} */
const id = (v, p) => v == null || (typeof v === "string" && ID.test(v)) ? null : `${p} should be an id`;
/** @type {Check} */
const key = (v, p) => v == null || (typeof v === "string" && KEY.test(v)) ? null : `${p} should be a key`;
/** A mailbox's id, made by the device (src/mailboxes/parse.js's). @type {Check} */
const mailboxId = (v, p) => v == null || (typeof v === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(v)) ? null : `${p} should be a mailbox`;
/** An X-Wing public key in base64url (1,216 bytes). @type {Check} */
const publicKey = (v, p) => v == null || (typeof v === "string" && /^[A-Za-z0-9_-]{1622}$/.test(v)) ? null : `${p} should be a public key`;
/** @type {Check} */
const link = (v, p) => v == null ? null
  : typeof v !== "string" || v.length > 2000 || !/^https?:\/\/\S+$/i.test(v) ? `${p} should be a web link` : null;
/** An object with v: 1 (a drawing's or pose's own format; its own checks come with the cache). @type {Check} */
const format1 = (v, p) => v == null || (typeof v === "object" && !Array.isArray(v) && /** @type {any} */ (v).v === 1) ? null : `${p} isn't in a known format`;
/** @type {Check} */
const object = (v, p) => v == null || (typeof v === "object" && !Array.isArray(v)) ? null : `${p} should be an object`;
/** @param {Check} check @returns {Check} */
const required = (check) => (v, p) => v == null || v === "" ? `${p} is needed` : check(v, p);

/**
 * A list of up to max, each checked.
 * @param {Check} each
 * @param {number} max
 * @returns {Check}
 */
const list = (each, max) => (v, p) => {
  if (v == null) return null;
  if (!Array.isArray(v)) return `${p} should be a list`;
  if (v.length > max) return `${p} has more than ${max}`;
  for (const [i, item] of v.entries()) {
    const problem = each(item, `${p}[${i}]`);
    if (problem) return problem;
  }
  return null;
};

/**
 * An object with these fields (others kept).
 * @param {Record<string, Check>} fields
 * @returns {Check}
 */
const shape = (fields) => (v, p) => {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return `${p} should be an object`;
  for (const [name, check] of Object.entries(fields)) {
    const problem = check(/** @type {any} */ (v)[name], `${p}.${name}`);
    if (problem) return problem;
  }
  return null;
};

/** Each visual: a file (its key, kind and caption with it), a drawing or a pose. @type {Check} */
const visual = (v, p) => {
  const base = shape({ kind: required(oneOf(VISUAL_KINDS)), id: required(id) })(v, p);
  if (base) return base;
  const entry = /** @type {any} */ (v);
  return entry.kind === "file"
    ? shape({ key: required(key), file_kind: required(oneOf(["photo", "video"])), mime: text(100), caption: text(LIMITS.caption),
      bytes: int(0, 2_000_000_000) })(v, p)
    : null;
};

const visuals = list(visual, 10_000);
const tags = list(required(id), LIMITS.tags);
const longText = text(LIMITS.longText);
const rating = int(1, 5);

/** Every kind's dates. */
const STAMPS = { created_at: timestamp, updated_at: timestamp };

/** @type {Record<RecordKind, Record<string, Check>>} */
export const FIELDS = {
  tie: {
    ...STAMPS,
    title: text(LIMITS.title),
    tie_date: required(date),
    tie_type: required(oneOf(TIE_TYPES)),
    duration_minutes: int(0, LIMITS.minutes),
    success_rating: rating,
    notes: longText,
    album_url: link,
    location_id: id,
    location_deleted: bool,
    workshop_id: id,
    participants: list(shape({
      person_id: id, role: required(oneOf(ROLES)), difficulty_rating: rating, experience_rating: rating, notes: longText,
    }), LIMITS.participants),
    plans: list(shape({ plan_id: id, plan_version: int(1, 1_000_000) }), LIMITS.plans),
    tags,
    visuals,
    cover: id,
  },
  plan: {
    ...STAMPS,
    title: required(text(LIMITS.title)),
    stage: oneOf(PLAN_STAGES),
    plan_type: oneOf(PLAN_TYPES),
    tie_type: oneOf(TIE_TYPES),
    description: longText,
    notes: longText,
    album_url: link,
    est_difficulty: rating,
    variation_of: id,
    version: int(1, 1_000_000),
    archived_at: timestamp,
    workshop_id: id,
    tags,
    visuals,
    cover: id,
  },
  person: {
    ...STAMPS,
    name: required(text(LIMITS.shortText)),
    pronouns: text(LIMITS.shortText),
    notes: longText,
    is_self: bool,
    default_role: oneOf(ROLES),
    is_educator: bool,
    based_in: text(LIMITS.shortText),
    aliases: list(shape({ platform: required(oneOf(ALIAS_PLATFORMS)), alias: required(text(LIMITS.shortText)) }), 50),
    about: longText,
    about_shared_on: date,
    profile_notes: list(shape({
      id: required(id), type: required(oneOf(PROFILE_NOTE_TYPES)), description: required(longText), noted_on: date, is_current: bool,
    }), 500),
    archived_at: timestamp,
  },
  location: {
    ...STAMPS,
    name: required(text(LIMITS.shortText)),
    notes: longText,
    maps_url: link,
    city: text(LIMITS.shortText),
    state_province: text(LIMITS.shortText),
    country: text(LIMITS.shortText),
    latitude: number(-90, 90),
    longitude: number(-180, 180),
    is_default: bool,
    archived_at: timestamp,
  },
  workshop: {
    ...STAMPS,
    title: required(text(LIMITS.title)),
    start_date: required(date),
    end_date: date,
    location_id: id,
    location_deleted: bool,
    attendee_count: int(0, LIMITS.attendees),
    rating, difficulty: rating, rating_content: rating, rating_teaching: rating, rating_value: rating,
    cost: text(LIMITS.shortText),
    event_url: link,
    description: longText,
    notes: longText,
    album_url: link,
    people: list(shape({
      person_id: id, kind: required(oneOf(["educator", "participant"])), role: oneOf(WORKSHOP_ROLES),
    }), LIMITS.workshopPeople),
    tags,
    visuals,
    cover: id,
  },
  tag: { ...STAMPS, name: required(text(LIMITS.tagName)) },
  drawing: { ...STAMPS, data: required(format1), caption: text(LIMITS.caption) },
  pose: { ...STAMPS, data: required(format1), caption: text(LIMITS.caption), picture: id },
  pose_preset: { ...STAMPS, kind: required(oneOf(["body", "arms"])), name: text(LIMITS.shortText), data: required(object) },
  // default_shape: the poser's body sliders, [gender, muscle, weight, height] (records/settings.js checks their ranges).
  settings: { ...STAMPS, top_label: text(LIMITS.roleName), bottom_label: text(LIMITS.roleName), default_shape: list(number(0, 1000), 4) },
  // Another account I'm connected to (contacts/rules.js): its pinned key and
  // account id, our mailboxes and pair key, the counters, and the person
  // it's on; or an invite of mine waiting.
  contact: {
    ...STAMPS,
    state: required(oneOf(["invited", "active", "removed"])),
    person_id: id,
    name: text(LIMITS.shortText),
    invited: bool,
    answered: bool,
    share_id: id,
    intro_mailbox: mailboxId,
    their_key: publicKey,
    their_user: id,
    their_mailbox: (v, p) => (v == null ? null : shape({ id: required(mailboxId), token: required(key) })(v, p)),
    my_mailbox: mailboxId,
    pair_key: key,
    sent: int(0, Number.MAX_SAFE_INTEGER),
    received: int(0, Number.MAX_SAFE_INTEGER),
    fields: object,
    verified: bool,
    key_changed: bool,
    pending_profile: object,
  },
};

/**
 * What's wrong with one record on its own, by the rules above and the few
 * that tie two of its fields together; empty if nothing.
 * @param {RecordKind} kind
 * @param {unknown} body
 * @param {{ id?: string }} [where] the record's id, outside its body
 * @returns {string[]}
 */
export function recordProblems(kind, body, { id: recordId } = {}) {
  if (!RECORD_KINDS.includes(kind)) return [`not a kind of record: ${kind}`];
  if (body == null || typeof body !== "object" || Array.isArray(body)) return ["a record should be an object"];
  const record = /** @type {Record<string, any>} */ (body);
  const problems = Object.entries(FIELDS[kind])
    .map(([name, check]) => check(record[name], name))
    .filter((p) => p !== null);
  if (kind === "workshop" && record.end_date && record.start_date && record.end_date < record.start_date) {
    problems.push("end_date is before start_date");
  }
  if ((kind === "tie" || kind === "workshop") && record.location_deleted && record.location_id) {
    problems.push("location_deleted with a location_id");
  }
  if (kind === "workshop" && Array.isArray(record.people)) {
    const ids = record.people.map((/** @type {any} */ person) => person?.person_id).filter(Boolean);
    if (new Set(ids).size !== ids.length) problems.push("someone is on the workshop twice");
  }
  if (kind === "plan" && record.variation_of && record.variation_of === recordId) problems.push("a plan can't be a variation of itself");
  if (kind === "settings" && record.top_label && record.bottom_label &&
      String(record.top_label).toLowerCase() === String(record.bottom_label).toLowerCase()) {
    problems.push("the two role names are the same");
  }
  if (Array.isArray(record.visuals)) {
    const ids = record.visuals.map((/** @type {any} */ v) => v?.id);
    if (new Set(ids).size !== ids.length) problems.push("a visual is listed twice");
    if (record.cover && !ids.includes(record.cover)) problems.push("the cover isn't one of its visuals");
  }
  return /** @type {string[]} */ (problems);
}

/** A record breaks its kind's rules. */
export class BadRecord extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`This entry couldn't be saved: ${problems[0]}.`);
    this.name = "BadRecord";
    this.problems = problems;
  }
}

/**
 * Throws BadRecord if a record breaks its kind's rules.
 * @param {RecordKind} kind
 * @param {unknown} body
 * @param {{ id?: string }} [where]
 */
export function checkRecord(kind, body, where) {
  const problems = recordProblems(kind, body, where);
  if (problems.length) throw new BadRecord(problems);
}
