// Parsing a submitted tie. Pure, so it's easy to test.

import { BadInput } from "../http.js";
import { cleanText, toIntOrNull, toChoiceOrNull } from "../parse.js";

export const ROLES = ["rigger", "top", "model", "bottom", "spotter", "photographer"];

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
    tie_date: cleanText(body.tie_date),
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
