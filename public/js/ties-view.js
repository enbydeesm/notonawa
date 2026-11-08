// How a tie is described in the list. Pure (no DOM), so it's easy to test.
//
// Labels come back as { text, deleted }; the page shows deleted ones muted
// and in italics.

import { capitalise } from "./format.js";

/**
 * Same lists as the API (src/ties/parse.js). Top and bottom are shown with
 * the account's names for them (roles.js).
 */
export const ROLES = ["top", "bottom", "self tie", "spotter", "photographer"];
/** A workshop's people can also audit (sit in and watch), which isn't a role on a tie (migration 0029). */
export const WORKSHOP_ROLES = [...ROLES, "audit"];
export const TIE_TYPES = ["suspension", "partial suspension", "floor", "hashira"];

/**
 * rating is set on the rating's label, so the page can draw it as rope
 * hanks (text stays the words for screen readers and copying).
 * @typedef {{ text: string, deleted: boolean, rating?: number }} Label
 */

/**
 * A tie's "Floor at Studio" line: the type, then "at" and the location if
 * there is one ("at Studio" with no type). Empty with neither.
 * @param {Record<string, any>} tie
 * @returns {Label[]} shown with spaces between
 */
export function placeLine(tie) {
  /** @type {Label[]} */
  const parts = [];
  if (tie.tie_type) parts.push({ text: capitalise(tie.tie_type), deleted: false });
  /** @type {Label | null} */
  const place = tie.location_name ? { text: tie.location_name, deleted: false }
    : tie.location_deleted ? { text: "(location deleted)", deleted: true }
    : null;
  if (place) parts.push({ text: "at", deleted: false }, place);
  return parts;
}

/**
 * The list header's count: "Showing 3 of 40 ties".
 * @param {number} shown ties matching the search
 * @param {number} total all my ties
 */
export function showingText(shown, total) {
  return `Showing ${shown} of ${total} ${total === 1 ? "tie" : "ties"}`;
}

/**
 * How many people fit on a tie's one-line "With:" list. widths[i] is the
 * i-th person's width (with the ", " before it); moreWidth(n) is the width
 * of the "+n" that says n more are hidden. Shows as many as fit, leaving
 * room for the "+n" when any are hidden.
 * @param {number[]} widths
 * @param {number} available
 * @param {(hidden: number) => number} moreWidth
 */
export function peopleThatFit(widths, available, moreWidth) {
  let used = 0;
  for (let i = 0; i < widths.length; i++) {
    used += widths[i];
    if (used > available) {
      // Person i doesn't fit: back off until the "+n" fits too.
      let shown = i;
      let width = used - widths[i];
      while (shown > 0 && width + moreWidth(widths.length - shown) > available) {
        shown--;
        width -= widths[shown];
      }
      return shown;
    }
  }
  return widths.length;
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
