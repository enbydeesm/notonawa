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
 *   location_name: string | null, latitude?: number | null, longitude?: number | null,
 *   participants: StatsParticipant[],
 * }} StatsTie
 * @typedef {{ key: string, label: string, count: number, tieIds: string[] }} Slice
 */

/** Self in one of these roles counts as a tie as top / as bottom. */
export const TOP_ROLES = ["top"];
export const BOTTOM_ROLES = ["bottom"];
/**
 * The parts the role-colored charts split a bar into, in order: my role on
 * the tie. "other" is only used when the role filter is spotter or
 * photographer, where every bar is one grey part.
 * @typedef {"top" | "bottom" | "self tie" | "other"} Segment
 * @type {Segment[]}
 */
export const SEGMENTS = ["top", "bottom", "self tie", "other"];
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
 * My role on a tie for the role-colored charts: top, bottom or self tie;
 * null if I was only spotting, taking photos, or not on it. A tie where I
 * was both top and bottom (a switch) counts once, as top.
 * @param {StatsTie} tie
 * @returns {"top" | "bottom" | "self tie" | null}
 */
export function myRole(tie) {
  if (selfIn(tie, TOP_ROLES)) return "top";
  if (selfIn(tie, BOTTOM_ROLES)) return "bottom";
  if (selfIn(tie, ["self tie"])) return "self tie";
  return null;
}

/**
 * The ties the role-colored charts count, and which part of a bar each is
 * in. With the role filter on spotter or photographer, every tie (they're
 * already only those) in one grey part; otherwise only the ties where I was
 * top, bottom or self tie, by that role.
 * @param {StatsTie[]} ties
 * @param {string} roleFilter the Analytics role filter's value
 * @returns {{ ties: StatsTie[], segmentOf: (tie: StatsTie) => Segment }}
 */
export function roleChartTies(ties, roleFilter) {
  if (roleFilter === "spotter" || roleFilter === "photographer") {
    return { ties, segmentOf: () => "other" };
  }
  return {
    ties: ties.filter((tie) => myRole(tie) !== null),
    segmentOf: (tie) => /** @type {Segment} */ (myRole(tie)),
  };
}

/**
 * Splits each bar (or partner) into parts by segmentOf, in SEGMENTS order,
 * keeping only parts with ties. The parts' counts add up to the bar's.
 * @template {{ count: number, tieIds: string[] }} T
 * @param {T[]} bars
 * @param {StatsTie[]} ties
 * @param {(tie: StatsTie) => Segment} segmentOf
 * @returns {(T & { segments: { key: Segment, count: number, tieIds: string[] }[] })[]}
 */
export function withSegments(bars, ties, segmentOf) {
  const byId = new Map(ties.map((tie) => [tie.id, tie]));
  return bars.map((bar) => {
    /** @type {Map<Segment, string[]>} */
    const parts = new Map();
    for (const id of bar.tieIds) {
      const tie = byId.get(id);
      if (!tie) continue;
      const key = segmentOf(tie);
      parts.set(key, [...(parts.get(key) ?? []), id]);
    }
    const segments = SEGMENTS.filter((key) => parts.has(key))
      .map((key) => ({ key, count: /** @type {string[]} */ (parts.get(key)).length, tieIds: /** @type {string[]} */ (parts.get(key)) }));
    return { ...bar, segments };
  });
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
 * Ties by day of the week, Sunday to Saturday, every day (for a bar each).
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
  return slices;
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
 * Most first; ties broken by name.
 * @param {Slice[]} slices
 */
function byCount(slices) {
  return [...slices].sort((a, b) => b.count - a.count
    || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/**
 * The heading of the list of ties behind a bar, slice or day:
 * "March 2026 · 8 ties".
 * @param {string} label
 * @param {number} count
 */
export function tieListHeading(label, count) {
  return `${label} · ${count === 1 ? "1 tie" : `${count} ties`}`;
}
