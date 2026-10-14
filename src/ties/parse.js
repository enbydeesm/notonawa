// Parsing a submitted tie. Pure, so it's easy to test.

import { BadInput } from "../http.js";
import { cleanText, toIntOrNull, toChoiceOrNull, toDateOrNull } from "../parse.js";
import { parseTagNames } from "../tags/parse.js";

export const ROLES = ["rigger", "top", "model", "bottom", "spotter", "photographer"];
export const TIE_TYPES = ["suspension", "partial suspension", "floor"];
/** @typedef {"locations" | "people" | "plans"} RecentType */
/** @type {RecentType[]} what /api/ties/recent/:type lists */
export const RECENT_TYPES = ["locations", "people", "plans"];

// Ties per page in the list. One place to change if it becomes adjustable.
export const PAGE_SIZE = 20;
const MAX_FILTER_IDS = 50;
const MAX_SEARCH_LENGTH = 200;
/** How the tags filter combines the chosen tags: ties with any of them, or all. */
export const TAG_MATCHES = ["any", "all"];

/**
 * @typedef {{ person_id: string, role: string }} ParticipantInput
 * @typedef {{
 *   title: string | null,
 *   tie_date: string,
 *   tie_type: string | null,
 *   notes: string | null,
 *   duration_minutes: number | null,
 *   success_rating: number | null,
 *   location_id: string | null,
 *   participants: ParticipantInput[],
 *   plan_ids: string[],
 *   tags: string[],
 * }} TieInput
 */

/**
 * Body: { title, tie_date, tie_type, duration_minutes, success_rating, notes, location_id,
 *         participants: [{ person_id, role }], plan_ids: [id], tags: [name] }
 * tags are names, so new tags (created on save) and existing ones are sent alike.
 * @param {Record<string, unknown>} body
 * @returns {TieInput}
 */
export function parseTieInput(body) {
  const tie = {
    title: cleanText(body.title),
    tie_date: toDateOrNull(body.tie_date),
    tie_type: toChoiceOrNull(body.tie_type, TIE_TYPES),
    notes: cleanText(body.notes),
    duration_minutes: toIntOrNull(body.duration_minutes, 0, 1440),
    success_rating: toIntOrNull(body.success_rating, 1, 5),
    location_id: cleanText(body.location_id),
    participants: parseParticipants(body.participants),
    plan_ids: parsePlanIds(body.plan_ids),
    tags: parseTagNames(body.tags),
  };
  // Every tie has a date, so a date search never leaves one out.
  const date = tie.tie_date;
  if (!date) throw new BadInput("Add a date.");
  return { ...tie, tie_date: date };
}

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
    const role = toChoiceOrNull(item?.role, ROLES);
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
 *   from: string | null,
 *   to: string | null,
 *   q: string | null,
 *   page: number,
 * }} TieFilters
 */

/**
 * The search body: person_ids, location_ids and tag_ids (lists), tag_match
 * ("any", the default, or "all"), from / to (tie dates, inclusive), q
 * (keyword) and page. All optional.
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
    q: cleanText(body.q),
    page: parsePage(body.page),
  };
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new BadInput("The start date is after the end date.");
  }
  if (filters.q && filters.q.length > MAX_SEARCH_LENGTH) {
    throw new BadInput(`Search for ${MAX_SEARCH_LENGTH} characters or fewer.`);
  }
  return filters;
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
function parsePage(value) {
  try {
    return toIntOrNull(value, 1, 100000) ?? 1;
  } catch {
    throw new BadInput("Page should be a whole number, 1 or more.");
  }
}
