// How a tie is described in the list. Pure (no DOM), so it's easy to test.
//
// Labels come back as { text, deleted }; the page shows deleted ones muted
// and in italics.

import { formatDate } from "./format.js";

/** Same list as the API (src/ties/parse.js). */
export const ROLES = ["rigger", "top", "model", "bottom", "spotter", "photographer"];

/** @typedef {{ text: string, deleted: boolean }} Label */

/**
 * Date, location, duration and rating, in display order.
 * @param {Record<string, any>} tie
 * @param {string} [locale]
 * @returns {Label[]}
 */
export function tieMeta(tie, locale) {
  /** @type {Label[]} */
  const parts = [{ text: formatDate(tie.tie_date, locale), deleted: false }];
  if (tie.location_name) parts.push({ text: tie.location_name, deleted: false });
  else if (tie.location_deleted) parts.push({ text: "(location deleted)", deleted: true });
  if (tie.duration_minutes != null) parts.push({ text: `${tie.duration_minutes} min`, deleted: false });
  if (tie.success_rating != null) parts.push({ text: `${tie.success_rating}/5`, deleted: false });
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
