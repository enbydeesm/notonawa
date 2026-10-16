// The analytics' numbers, worked out on the device from the ties the server
// sends (POST /api/stats/ties). Pure, so it's easy to test. Everything that
// can become a bar or a slice keeps the ids of its ties, so a later version
// can list them when it's tapped.

import { TIE_TYPES } from "./ties-view.js";
import { capitalise } from "./format.js";

/**
 * @typedef {{ person_id: string | null, person_name: string | null, is_self: boolean, role: string }} StatsParticipant
 * @typedef {{
 *   id: string, tie_date: string, tie_type: string | null, duration_minutes: number | null,
 *   success_rating: number | null, location_id: string | null, location_deleted: number,
 *   location_name: string | null, participants: StatsParticipant[],
 * }} StatsTie
 * @typedef {{ key: string, label: string, count: number, tieIds: string[] }} Slice
 */

/** Self in one of these roles counts as a tie as top / as bottom. */
export const TOP_ROLES = ["rigger", "top"];
export const BOTTOM_ROLES = ["model", "bottom"];
/** Someone only spotting or taking photos isn't counted as a partner. */
export const NOT_PARTNER_ROLES = ["spotter", "photographer"];

/** Sunday first, as Date.getUTCDay() counts. */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * @param {StatsTie} tie
 * @param {string[]} roles
 */
function selfIn(tie, roles) {
  return tie.participants.some((p) => p.is_self && roles.includes(p.role));
}

/**
 * The people who count as partners on a tie: not me, not deleted, and in
 * at least one role other than spotter or photographer.
 * @param {StatsTie} tie
 * @returns {Map<string, string>} id -> name
 */
function partnersOf(tie) {
  /** @type {Map<string, string>} */
  const partners = new Map();
  for (const p of tie.participants) {
    if (p.is_self || !p.person_id || NOT_PARTNER_ROLES.includes(p.role)) continue;
    partners.set(p.person_id, p.person_name ?? "");
  }
  return partners;
}

/**
 * The numbers at the top: how many ties, partners and locations; ties with
 * me as top or bottom; total and average length (of the ties with one);
 * how many different days; and the average rating (of the rated ties).
 * @param {StatsTie[]} ties
 */
export function summarize(ties) {
  const partners = new Set();
  const locations = new Set();
  const days = new Set();
  let asTop = 0, asBottom = 0, minutes = 0, timed = 0, ratingSum = 0, rated = 0;
  for (const tie of ties) {
    for (const id of partnersOf(tie).keys()) partners.add(id);
    if (tie.location_id) locations.add(tie.location_id);
    days.add(tie.tie_date);
    if (selfIn(tie, TOP_ROLES)) asTop++;
    if (selfIn(tie, BOTTOM_ROLES)) asBottom++;
    if (tie.duration_minutes != null) { minutes += tie.duration_minutes; timed++; }
    if (tie.success_rating != null) { ratingSum += tie.success_rating; rated++; }
  }
  return {
    ties: ties.length,
    partners: partners.size,
    locations: locations.size,
    days: days.size,
    asTop,
    asBottom,
    minutes,
    avgMinutes: timed ? Math.round(minutes / timed) : null,
    avgRating: rated ? Math.round((ratingSum / rated) * 10) / 10 : null,
  };
}

/**
 * Who I tied with most, most ties first (then by name).
 * @param {StatsTie[]} ties
 * @param {number} limit
 * @returns {Slice[]} key: the person's id
 */
export function topPartners(ties, limit) {
  /** @type {Map<string, Slice>} */
  const counts = new Map();
  for (const tie of ties) {
    for (const [id, name] of partnersOf(tie)) {
      const slice = counts.get(id) ?? { key: id, label: name, count: 0, tieIds: [] };
      slice.count++;
      slice.tieIds.push(tie.id);
      counts.set(id, slice);
    }
  }
  return byCount([...counts.values()]).slice(0, limit);
}

/**
 * Ties by type: suspension, partial suspension, floor, then any without a
 * type. Only types with ties.
 * @param {StatsTie[]} ties
 * @returns {Slice[]}
 */
export function typeShares(ties) {
  const slices = [...TIE_TYPES, null].map((type) => ({
    key: type ?? "none", label: type ? capitalise(type) : "Not set", count: 0, tieIds: /** @type {string[]} */ ([]),
  }));
  for (const tie of ties) {
    const slice = slices[tie.tie_type ? TIE_TYPES.indexOf(tie.tie_type) : TIE_TYPES.length] ?? slices[TIE_TYPES.length];
    slice.count++;
    slice.tieIds.push(tie.id);
  }
  return slices.filter((s) => s.count > 0);
}

/**
 * Ties by day of the week, busiest first. Only days with ties.
 * @param {StatsTie[]} ties
 * @returns {Slice[]}
 */
export function weekdayShares(ties) {
  const slices = WEEKDAYS.map((label) => ({ key: label, label, count: 0, tieIds: /** @type {string[]} */ ([]) }));
  for (const tie of ties) {
    const [y, m, d] = tie.tie_date.split("-").map(Number);
    const slice = slices[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    slice.count++;
    slice.tieIds.push(tie.id);
  }
  return byCount(slices.filter((s) => s.count > 0), true);
}

/**
 * Ties by location: the busiest few, then the rest together as "Other".
 * Ties with no location, or one since deleted, count as places of their own.
 * @param {StatsTie[]} ties
 * @param {number} shown how many locations get a slice of their own
 * @returns {Slice[]}
 */
export function locationShares(ties, shown) {
  /** @type {Map<string, Slice>} */
  const counts = new Map();
  for (const tie of ties) {
    const [key, label] = tie.location_id ? [tie.location_id, tie.location_name ?? ""]
      : tie.location_deleted ? ["deleted", "(location deleted)"]
      : ["none", "No location"];
    const slice = counts.get(key) ?? { key, label, count: 0, tieIds: [] };
    slice.count++;
    slice.tieIds.push(tie.id);
    counts.set(key, slice);
  }
  const sorted = byCount([...counts.values()]);
  if (sorted.length <= shown + 1) return sorted;
  const rest = sorted.slice(shown);
  return [
    ...sorted.slice(0, shown),
    { key: "other", label: "Other", count: rest.reduce((n, s) => n + s.count, 0), tieIds: rest.flatMap((s) => s.tieIds) },
  ];
}

/**
 * The ties on each day, for the calendar.
 * @param {StatsTie[]} ties
 * @returns {Map<string, string[]>} "YYYY-MM-DD" -> tie ids
 */
export function tiesByDay(ties) {
  /** @type {Map<string, string[]>} */
  const days = new Map();
  for (const tie of ties) days.set(tie.tie_date, [...(days.get(tie.tie_date) ?? []), tie.id]);
  return days;
}

/**
 * A whole-number percentage, 0 when there's nothing to divide by.
 * @param {number} part
 * @param {number} whole
 */
export function percent(part, whole) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

/**
 * Total time: "≈98h", or minutes while under an hour.
 * @param {number} minutes
 */
export function formatTotalTime(minutes) {
  if (minutes < 60) return `${minutes}m`;
  return `≈${Math.round(minutes / 60)}h`;
}

/**
 * Most first; ties broken by name (or, for the days of the week, kept in
 * week order).
 * @param {Slice[]} slices
 * @param {boolean} [keepOrder]
 */
function byCount(slices, keepOrder = false) {
  return slices
    .map((slice, i) => ({ slice, i }))
    .sort((a, b) => b.slice.count - a.slice.count
      || (keepOrder ? a.i - b.i : a.slice.label.localeCompare(b.slice.label, undefined, { sensitivity: "base" })))
    .map(({ slice }) => slice);
}
