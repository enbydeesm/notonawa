// How a tie is described in the list. Pure (no DOM), so it's easy to test.
//
// Labels come back as { text, deleted }; the page shows deleted ones muted
// and in italics.

import { formatDate, capitalise } from "./format.js";

/** Same lists as the API (src/ties/parse.js). */
export const ROLES = ["rigger", "top", "model", "bottom", "spotter", "photographer"];
export const TIE_TYPES = ["suspension", "partial suspension", "floor"];

/**
 * rating is set on the rating's label, so the page can draw it as rope
 * hanks (text stays the words for screen readers and copying).
 * @typedef {{ text: string, deleted: boolean, rating?: number }} Label
 */

/**
 * Date, type, location, duration and rating, in display order.
 * @param {Record<string, any>} tie
 * @param {string} [locale]
 * @returns {Label[]}
 */
export function tieMeta(tie, locale) {
  /** @type {Label[]} */
  const parts = [{ text: formatDate(tie.tie_date, locale), deleted: false }];
  if (tie.tie_type) parts.push({ text: capitalise(tie.tie_type), deleted: false });
  if (tie.location_name) parts.push({ text: tie.location_name, deleted: false });
  else if (tie.location_deleted) parts.push({ text: "(location deleted)", deleted: true });
  if (tie.duration_minutes != null) parts.push({ text: `${tie.duration_minutes} min`, deleted: false });
  if (tie.success_rating != null) parts.push({ text: `${tie.success_rating}/5`, deleted: false, rating: tie.success_rating });
  return parts;
}

/**
 * @param {{ person_name: string | null, role: string }} participant
 * @returns {{ name: Label, role: string }}
 */
export function participantLabel({ person_name, role }) {
  return {
    name: person_name ? { text: person_name, deleted: false } : { text: "(person deleted)", deleted: true },
    role,
  };
}

/**
 * @param {{ plan_title: string | null, plan_version: number }} plan
 * @returns {Label}
 */
export function planLabel({ plan_title, plan_version }) {
  return plan_title
    ? { text: `${plan_title} (v${plan_version})`, deleted: false }
    : { text: "(plan deleted)", deleted: true };
}

/** The most rope hanks a rating can have. Same as the API's 1 to 5. */
export const MAX_RATING = 5;

/**
 * The rating after tapping a hank: that many hanks, or none if it's the
 * one already chosen (so a rating can be cleared).
 * @param {number | null} current
 * @param {number} tapped 1 to MAX_RATING
 * @returns {number | null}
 */
export function nextRating(current, tapped) {
  return current === tapped ? null : tapped;
}
