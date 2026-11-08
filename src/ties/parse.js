// Parsing a submitted tie. Pure, so it's easy to test.

import { BadInput } from "../http.js";
import { cleanText, toIntOrNull, toChoiceOrNull, toDateOrNull, encryptedText } from "../parse.js";
import { parseTagNames } from "../tags/parse.js";

/**
 * The roles on a tie (migration 0013). Top and bottom are one role each;
 * the words shown for them are each account's choice (users.top_label and
 * bottom_label; see src/account/settings.js).
 */
export const ROLES = ["top", "bottom", "self tie", "spotter", "photographer"];
/** A workshop's people can also audit (sit in and watch), not a role on a tie (migration 0029). */
export const WORKSHOP_ROLES = [...ROLES, "audit"];
/** What older exports, CSVs and pages call top and bottom. */
const OLD_ROLES = /** @type {Record<string, string>} */ ({ rigger: "top", model: "bottom" });
export const TIE_TYPES = ["suspension", "partial suspension", "floor", "hashira"];
/** @typedef {"locations" | "people" | "plans"} RecentType */
/** @type {RecentType[]} what /api/ties/recent/:type lists */
export const RECENT_TYPES = ["locations", "people", "plans"];

// Ties per page in the list: the default, and the sizes the page offers.
export const PAGE_SIZE = 20;
export const PAGE_SIZES = [20, 50, 100];
/** Newest tie date first (the default), or oldest first. */
export const SORTS = ["newest", "oldest"];
const MAX_FILTER_IDS = 50;
// Ties a keyword search found (on the device): as many as anyone has.
const MAX_MATCH_IDS = 20_000;
/** How the tags filter combines the chosen tags: ties with any of them, or all. */
export const TAG_MATCHES = ["any", "all"];

/**
 * A role, or null if empty; "rigger" and "model" (from before migration
 * 0013) are read as top and bottom.
 * @param {unknown} value
 * @returns {string | null}
 */
export function toRoleOrNull(value) {
  return roleFrom(value, ROLES);
}

/**
 * A role on a workshop (a tie's, or audit), or null if empty; read as
 * toRoleOrNull reads them.
 * @param {unknown} value
 * @returns {string | null}
 */
export function toWorkshopRoleOrNull(value) {
  return roleFrom(value, WORKSHOP_ROLES);
}

/** @param {unknown} value @param {string[]} roles */
function roleFrom(value, roles) {
  const text = cleanText(value);
  return toChoiceOrNull(text !== null && Object.hasOwn(OLD_ROLES, text) ? OLD_ROLES[text] : text, roles);
}

/**
 * @typedef {{ person_id: string, role: string }} ParticipantInput
 * @typedef {{
 *   title: string | null,
 *   tie_date: string,
 *   tie_type: string,
 *   notes: string | null,
 *   album_url: string | null,
 *   duration_minutes: number | null,
 *   success_rating: number | null,
 *   location_id: string | null,
 *   workshop_id: string | null,
 *   participants: ParticipantInput[],
 *   plan_ids: string[],
 *   tags: string[],
 * }} TieInput
 */

/**
 * Body: { title, tie_date, tie_type, duration_minutes, success_rating, notes, album_url,
 *         location_id, workshop_id, participants: [{ person_id, role }], plan_ids: [id], tags: [name] }
 * workshop_id: the workshop it was tied at, if any (migration 0030).
 * tags are names, so new tags (created on save) and existing ones are sent alike.
 * tie_type is required (migration 0014).
 * @param {Record<string, unknown>} body
 * @returns {TieInput}
 */
export function parseTieInput(body) {
  const tie = {
    title: cleanText(body.title),
    tie_date: toDateOrNull(body.tie_date),
    tie_type: toChoiceOrNull(body.tie_type, TIE_TYPES),
    // Encrypted in the browser.
    notes: encryptedText(body.notes),
    album_url: encryptedText(body.album_url),
    duration_minutes: toIntOrNull(body.duration_minutes, 0, 1440),
    success_rating: toIntOrNull(body.success_rating, 1, 5),
    location_id: cleanText(body.location_id),
    workshop_id: cleanText(body.workshop_id),
    participants: parseParticipants(body.participants),
    plan_ids: parsePlanIds(body.plan_ids),
    tags: parseTagNames(body.tags),
  };
  // Every tie has a date, so a date search never leaves one out.
  const { tie_date: date, tie_type: type } = tie;
  if (!date) throw new BadInput("Add a date.");
  if (!type) throw new BadInput(TYPE_NEEDED);
  return { ...tie, tie_date: date, tie_type: type };
}

/** What a tie without a type is told, from the form or an import. */
export const TYPE_NEEDED = "Choose a tie type: suspension, partial suspension, floor or hashira.";

/**
 * @param {unknown} value
 * @returns {ParticipantInput[]}
 */
export function parseParticipants(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new BadInput("Participants should be a list of up to 20 people.");
  }
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const personId = cleanText(item?.person_id);
    const role = toRoleOrNull(item?.role);
    if (!personId || !role) throw new BadInput("Each participant needs a person and a role.");
    const key = `${personId}|${role}`;
    if (seen.has(key)) continue; // same person in the same role twice: keep one
    seen.add(key);
    result.push({ person_id: personId, role });
  }
  return result;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function parsePlanIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new BadInput("Plans should be a list of up to 20 plans.");
  }
  return [...new Set(value.map(cleanText).filter((id) => id !== null))];
}

/**
 * @typedef {{
 *   person_ids: string[],
 *   location_ids: string[],
 *   tag_ids: string[],
 *   tag_match: string,
 *   person_match?: string,
 *   from: string | null,
 *   to: string | null,
 *   match_ids: string[] | null,
 *   page: number,
 *   page_size: number,
 *   sort: string,
 * }} TieFilters
 */

/**
 * The search body: person_ids, location_ids and tag_ids (lists), tag_match
 * ("any", the default, or "all"), from / to (tie dates, inclusive),
 * match_ids (the ties a keyword matched, searched for on the device; null
 * or left out for no keyword), page, page_size (20, 50 or 100) and sort
 * ("newest", the default, or "oldest"). All optional. A keyword itself (q)
 * is refused: it never comes to the server.
 * @param {Record<string, unknown>} body
 * @returns {TieFilters}
 */
export function parseTieFilters(body) {
  const filters = {
    person_ids: parseIdList(body.person_ids, "people"),
    location_ids: parseIdList(body.location_ids, "locations"),
    tag_ids: parseIdList(body.tag_ids, "tags"),
    tag_match: parseTagMatch(body.tag_match),
    from: toDateOrNull(body.from),
    to: toDateOrNull(body.to),
    match_ids: parseMatchIds(body.match_ids),
    page: parsePage(body.page),
    page_size: parsePageSize(body.page_size),
    sort: parseSort(body.sort),
  };
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new BadInput("The start date is after the end date.");
  }
  if (body.q !== undefined) throw new BadInput("Keyword search happens on your device. Reload the page and try again.");
  return filters;
}

/**
 * @param {unknown} value
 * @returns {string[] | null}
 */
function parseMatchIds(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_MATCH_IDS || value.some((id) => typeof id !== "string")) {
    throw new BadInput("Couldn't search. Reload the page and try again.");
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} what for the error message
 * @returns {string[]}
 */
function parseIdList(value, what) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadInput(`Choose ${what} as a list.`);
  // Duplicates removed: the "all of these" filters count matches.
  const ids = [...new Set(value.map(cleanText).filter((id) => id !== null))];
  if (ids.length > MAX_FILTER_IDS) throw new BadInput(`Choose up to ${MAX_FILTER_IDS} ${what}.`);
  return ids;
}

/** @param {unknown} value */
function parseTagMatch(value) {
  try {
    return toChoiceOrNull(value, TAG_MATCHES) ?? "any";
  } catch {
    throw new BadInput("Match any or all of the tags.");
  }
}

/** @param {unknown} value */
function parsePageSize(value) {
  if (value === undefined || value === null || value === "") return PAGE_SIZE;
  const size = Number(value);
  if (!PAGE_SIZES.includes(size)) throw new BadInput(`Show ${PAGE_SIZES.join(", ")} ties per page.`);
  return size;
}

/** @param {unknown} value */
function parseSort(value) {
  try {
    return toChoiceOrNull(value, SORTS) ?? "newest";
  } catch {
    throw new BadInput("Sort by newest or oldest.");
  }
}

/** @param {unknown} value */
function parsePage(value) {
  try {
    return toIntOrNull(value, 1, 100000) ?? 1;
  } catch {
    throw new BadInput("Page should be a whole number, 1 or more.");
  }
}

/**
 * Links on a tie to people, plans or a location that have since been
 * deleted, which the edit form shows as "(… deleted)" and can remove but not
 * change. Ones listed here are kept when the tie is saved; the rest go.
 * participants and plans are the link rows' ids.
 * @typedef {{ participants: string[], plans: string[], location: boolean }} KeptDeleted
 */

/**
 * Body: as parseTieInput, plus keep_deleted: { participants: [link id],
 * plans: [link id], location: true|false } (optional).
 * @param {Record<string, unknown>} body
 * @returns {TieInput & { keep_deleted: KeptDeleted }}
 */
export function parseTieUpdate(body) {
  const tie = parseTieInput(body);
  const keep = body.keep_deleted ?? {};
  if (typeof keep !== "object" || Array.isArray(keep)) throw new BadInput("keep_deleted should be an object.");
  const k = /** @type {Record<string, unknown>} */ (keep);
  return {
    ...tie,
    keep_deleted: {
      participants: parseIdList(k.participants, "deleted people"),
      plans: parseIdList(k.plans, "deleted plans"),
      location: k.location === true,
    },
  };
}
