// Parsing a submitted tie. Pure, so it's easy to test.

import { BadInput } from "../http.js";
import { cleanText, toIntOrNull, toChoiceOrNull, toDateOrNull } from "../parse.js";

export const ROLES = ["rigger", "top", "model", "bottom", "spotter", "photographer"];

// Ties per page in the list. One place to change if it becomes adjustable.
export const PAGE_SIZE = 20;
const MAX_FILTER_IDS = 50;
const MAX_SEARCH_LENGTH = 200;

/**
 * @typedef {{ person_id: string, role: string }} ParticipantInput
 * @typedef {{
 *   title: string | null,
 *   tie_date: string | null,
 *   notes: string | null,
 *   duration_minutes: number | null,
 *   success_rating: number | null,
 *   location_id: string | null,
 *   participants: ParticipantInput[],
 *   plan_ids: string[],
 * }} TieInput
 */

/**
 * Body: { title, tie_date, duration_minutes, success_rating, notes, location_id,
 *         participants: [{ person_id, role }], plan_ids: [id] }
 * @param {Record<string, unknown>} body
 * @returns {TieInput}
 */
export function parseTieInput(body) {
  const tie = {
    title: cleanText(body.title),
    tie_date: toDateOrNull(body.tie_date),
    notes: cleanText(body.notes),
    duration_minutes: toIntOrNull(body.duration_minutes, 0, 1440),
    success_rating: toIntOrNull(body.success_rating, 1, 5),
    location_id: cleanText(body.location_id),
    participants: parseParticipants(body.participants),
    plan_ids: parsePlanIds(body.plan_ids),
  };
  if (!tie.title && !tie.tie_date) {
    throw new BadInput("Add at least a title or a date.");
  }
  return tie;
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
 *   from: string | null,
 *   to: string | null,
 *   q: string | null,
 *   page: number,
 * }} TieFilters
 */

/**
 * The list's query string: person_id and location_id (each repeatable),
 * from / to (tie dates, inclusive), q (keyword) and page. All optional.
 * @param {URLSearchParams} params
 * @returns {TieFilters}
 */
export function parseTieFilters(params) {
  const filters = {
    person_ids: parseIdList(params.getAll("person_id"), "people"),
    location_ids: parseIdList(params.getAll("location_id"), "locations"),
    from: toDateOrNull(params.get("from")),
    to: toDateOrNull(params.get("to")),
    q: cleanText(params.get("q")),
    page: parsePage(params.get("page")),
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
 * @param {string[]} values
 * @param {string} what for the error message
 * @returns {string[]}
 */
function parseIdList(values, what) {
  // Duplicates removed: the "all of these people" filter counts matches.
  const ids = [...new Set(values.map(cleanText).filter((id) => id !== null))];
  if (ids.length > MAX_FILTER_IDS) throw new BadInput(`Choose up to ${MAX_FILTER_IDS} ${what}.`);
  return ids;
}

/** @param {string | null} value */
function parsePage(value) {
  try {
    return toIntOrNull(value, 1, 100000) ?? 1;
  } catch {
    throw new BadInput("Page should be a whole number, 1 or more.");
  }
}
