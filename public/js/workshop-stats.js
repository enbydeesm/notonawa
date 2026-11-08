// Analytics' workshop numbers (views/analytics.js): pure, so they're easy to
// test. Workshops follow the chosen period only (by their start date); the
// role and More filters are for ties.
//
// A follow-up tie is one on a plan linked to a workshop: what was learned
// there, tied again later. Ties linked straight to a workshop happened at
// it, so they're not follow-ups of it.

import { isTaught, workshopDays } from "./workshops-view.js";
import { totalsByCurrency } from "./currency.js";
import { project } from "./map-geo.js";

/**
 * @typedef {import("./workshops-view.js").Workshop & {
 *   cost?: string | null,
 *   linked?: { kind: "tie" | "plan", id: string }[],
 * }} StatsWorkshop opened, as GET /api/workshops lists them
 * @typedef {{ id: string, workshop_id?: string | null, linked_ties?: { id: string }[] }} StatsPlan
 * @typedef {{ from: string | null, to: string | null }} DateRange
 */

/**
 * The workshops starting in the range (null: open-ended).
 * @template {{ start_date: string }} W
 * @param {W[]} workshops
 * @param {DateRange} range
 * @returns {W[]}
 */
export function workshopsIn(workshops, { from, to }) {
  return workshops.filter((w) => (from === null || w.start_date >= from) && (to === null || w.start_date <= to));
}

/**
 * Each workshop's follow-up ties: the ties on the plans linked to it, less
 * the ones linked straight to it (tied there).
 * @param {StatsWorkshop[]} workshops
 * @param {StatsPlan[]} plans
 * @returns {Map<string, Set<string>>} by workshop id
 */
export function followUps(workshops, plans) {
  /** @type {Map<string, Set<string>>} */
  const byWorkshop = new Map(workshops.map((w) => [w.id, new Set()]));
  for (const plan of plans) {
    const set = plan.workshop_id ? byWorkshop.get(plan.workshop_id) : undefined;
    if (set) for (const tie of plan.linked_ties ?? []) set.add(tie.id);
  }
  for (const w of workshops) {
    const set = /** @type {Set<string>} */ (byWorkshop.get(w.id));
    for (const item of w.linked ?? []) if (item.kind === "tie") set.delete(item.id);
  }
  return byWorkshop;
}

/**
 * The Workshops card's numbers for the period's workshops, and the share
 * of the period's ties that are follow-ups of any workshop.
 * @param {StatsWorkshop[]} workshops in the period (workshopsIn)
 * @param {Map<string, Set<string>>} followUpTies every workshop's (followUps)
 * @param {{ id: string }[]} ties the period's ties, as filtered
 * @param {string | null} selfId
 */
export function workshopNumbers(workshops, followUpTies, ties, selfId) {
  const taught = workshops.filter((w) => isTaught(w, selfId));
  const attended = workshops.filter((w) => !isTaught(w, selfId));
  const anyFollowUp = new Set([...followUpTies.values()].flatMap((set) => [...set]));
  const followUpCount = ties.filter((t) => anyFollowUp.has(t.id)).length;
  return {
    attended: attended.length,
    taught: taught.length,
    days: workshops.reduce((sum, w) => sum + workshopDays(w), 0),
    spend: totalsByCurrency(attended.map((w) => w.cost)),
    earned: totalsByCurrency(taught.map((w) => w.cost)),
    followUps: followUpCount,
    followUpShare: ties.length ? Math.round((followUpCount / ties.length) * 100) : 0,
  };
}

/**
 * Practised most: the period's workshops with follow-up ties (of any
 * date), the most first (then the newest), up to max.
 * @param {StatsWorkshop[]} workshops in the period
 * @param {Map<string, Set<string>>} followUpTies
 * @param {number} [max]
 * @returns {{ id: string, title: string, tieIds: string[] }[]}
 */
export function practisedMost(workshops, followUpTies, max = 8) {
  return workshops
    .map((w) => ({ id: w.id, title: w.title, start: w.start_date, tieIds: [...(followUpTies.get(w.id) ?? [])] }))
    .filter((w) => w.tieIds.length > 0)
    .sort((a, b) => b.tieIds.length - a.tieIds.length || b.start.localeCompare(a.start))
    .slice(0, max)
    .map(({ id, title, tieIds }) => ({ id, title, tieIds }));
}

/**
 * The workshops starting in each bar of the tie count chart (a day's, a
 * month's or a year's), for its marks.
 * @param {{ key: string }[]} bars as stats-period.js's buckets makes them
 * @param {StatsWorkshop[]} workshops
 * @returns {StatsWorkshop[][]} one list per bar
 */
export function workshopsByBar(bars, workshops) {
  const keyLength = bars[0]?.key.length ?? 0;
  const at = new Map(bars.map((bar, i) => [bar.key, i]));
  /** @type {StatsWorkshop[][]} */
  const lists = bars.map(() => []);
  for (const w of workshops) {
    const i = at.get(w.start_date.slice(0, keyLength));
    if (i !== undefined) lists[i].push(w);
  }
  return lists;
}

/**
 * The map's workshop places: each location with coordinates that has one
 * of these workshops, with their ids. Ones without a location (or whose
 * location has no coordinates) aren't on it.
 * @param {StatsWorkshop[]} workshops
 * @param {{ id: string, name: string, latitude: number | null, longitude: number | null }[]} locations
 * @returns {{ key: string, label: string, x: number, y: number, workshopIds: string[], tieIds: string[] }[]}
 */
export function workshopPlaces(workshops, locations) {
  const where = new Map(locations.map((l) => [l.id, l]));
  /** @type {Map<string, { key: string, label: string, x: number, y: number, workshopIds: string[], tieIds: string[] }>} */
  const byId = new Map();
  for (const w of workshops) {
    const l = w.location_id ? where.get(w.location_id) : undefined;
    if (!l || typeof l.latitude !== "number" || typeof l.longitude !== "number") continue;
    let place = byId.get(l.id);
    if (!place) {
      place = { key: l.id, label: l.name || "(no name)", ...project(l.latitude, l.longitude), workshopIds: [], tieIds: [] };
      byId.set(l.id, place);
    }
    place.workshopIds.push(w.id);
  }
  return [...byId.values()];
}
