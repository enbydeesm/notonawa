// What the Education view shows and works out: the search over workshops,
// which ones I attended and which I taught, their dates in words, and the
// Summary's numbers. Pure (no DOM), so it's easy to test.
//
// All my workshops are loaded at once (GET /api/workshops) with their
// description and notes opened, so the search runs here and nothing typed
// goes to the server. It isn't kept in the address either: it starts empty
// each time Education is shown.

import { normaliseKeyword } from "./search-match.js";
import { formatDate } from "./format.js";
import { ROLES } from "./ties-view.js";
import { totalsByCurrency } from "./currency.js";

/**
 * @typedef {{ id: string, person_id: string | null, person_name: string | null, role: string }} WorkshopPerson
 * @typedef {Record<string, any> & {
 *   id: string, title: string, start_date: string, end_date: string | null,
 *   location_id: string | null, location_name: string | null,
 *   attendee_count: number | null, rating: number | null,
 *   educators: WorkshopPerson[], participants: WorkshopPerson[], tags: string[],
 * }} Workshop
 * @typedef {{
 *   q: string,
 *   person_ids: string[],
 *   educator_ids: string[],
 *   location_ids: string[],
 *   from: string,
 *   to: string,
 *   tags: string[],
 *   tag_match: "any" | "all",
 * }} WorkshopSearch
 *   person_ids: workshops with all of them (as an educator or a
 *   participant); educator_ids: with all of them as educators;
 *   location_ids: at any of them; from / to: YYYY-MM-DD or "" (a workshop
 *   counts if any of its days is in the range); tags: names
 */

/** @type {WorkshopSearch} */
export const EMPTY_SEARCH = {
  q: "", person_ids: [], educator_ids: [], location_ids: [], from: "", to: "", tags: [], tag_match: "any",
};

/** The Education view's tabs, in order. */
export const TABS = /** @type {const} */ (["attended", "taught", "summary"]);

/**
 * Whether anything narrows the list.
 * @param {WorkshopSearch} search
 */
export function hasWorkshopFilters(search) {
  return normaliseKeyword(search.q) !== null || search.person_ids.length > 0 || search.educator_ids.length > 0 ||
    search.location_ids.length > 0 || search.from !== "" || search.to !== "" || search.tags.length > 0;
}

/**
 * The workshops the search finds, in the order given. The keyword is
 * looked for in the title, description and notes, ignoring capitals.
 * @template {Workshop} W
 * @param {W[]} workshops
 * @param {WorkshopSearch} search
 * @returns {W[]}
 */
export function filterWorkshops(workshops, search) {
  const keyword = normaliseKeyword(search.q);
  const has = (/** @type {unknown} */ text) => typeof text === "string" && text.toLocaleLowerCase().includes(/** @type {string} */ (keyword));
  const wanted = search.tags.map((name) => name.toLocaleLowerCase());
  return workshops.filter((w) => {
    if (keyword !== null && !has(w.title) && !has(w.description) && !has(w.notes)) return false;
    const everyone = new Set([...w.educators, ...w.participants].map((p) => p.person_id));
    if (!search.person_ids.every((id) => everyone.has(id))) return false;
    const educators = new Set(w.educators.map((p) => p.person_id));
    if (!search.educator_ids.every((id) => educators.has(id))) return false;
    if (search.location_ids.length && !(w.location_id && search.location_ids.includes(w.location_id))) return false;
    if (search.to && w.start_date > search.to) return false;
    if (search.from && (w.end_date ?? w.start_date) < search.from) return false;
    if (wanted.length) {
      const mine = w.tags.map((name) => name.toLocaleLowerCase());
      const found = wanted.filter((name) => mine.includes(name)).length;
      if (search.tag_match === "all" ? found < wanted.length : found === 0) return false;
    }
    return true;
  });
}

/**
 * Whether I taught it: my "this is me" profile is one of its educators.
 * @param {Workshop} workshop
 * @param {string | null} selfId
 */
export function isTaught(workshop, selfId) {
  return selfId !== null && workshop.educators.some((p) => p.person_id === selfId);
}

/**
 * A new tie started from a workshop's "Ties and plans": linked to it, at its
 * location (not one since deleted), with its people (not its educators,
 * who teach; not people since deleted). A role ties don't have (audit) is
 * left for the form: picking the person fills in their usual role. The
 * date is today while the workshop is on, otherwise its start date.
 * @param {{ id: string, title: string, start_date: string, end_date: string | null, location_id: string | null,
 *   location_name?: string | null, participants: WorkshopPerson[] }} workshop
 * @param {string} today YYYY-MM-DD
 * @returns {{ workshop_id: string, workshop_title: string, tie_date: string, location_id: string | null,
 *   location_name: string | null, people: { person_id: string, person_name: string, role: string | null }[] }}
 */
export function tieFromWorkshop(workshop, today) {
  const end = workshop.end_date ?? workshop.start_date;
  return {
    workshop_id: workshop.id,
    workshop_title: workshop.title,
    tie_date: today >= workshop.start_date && today <= end ? today : workshop.start_date,
    location_id: workshop.location_id ?? null,
    location_name: workshop.location_id ? workshop.location_name ?? "" : null,
    people: workshop.participants.flatMap((p) => (p.person_id === null ? [] : [{
      person_id: p.person_id, person_name: p.person_name ?? "", role: ROLES.includes(p.role) ? p.role : null,
    }])),
  };
}

/**
 * The cost field's label in the form: what I paid, or, once I'm one of the
 * educators (a workshop I teach), what I earned. Only one amount is kept;
 * which it is follows the educators, as isTaught does.
 * @param {string[]} educatorIds the people chosen as educators so far
 * @param {string | null} selfId
 * @returns {"Paid" | "Earned"}
 */
export function amountLabel(educatorIds, selfId) {
  return selfId !== null && educatorIds.includes(selfId) ? "Earned" : "Paid";
}

/**
 * The workshops I attended (I'm not one of the educators) and the ones I taught.
 * @template {Workshop} W
 * @param {W[]} workshops
 * @param {string | null} selfId
 * @returns {{ attended: W[], taught: W[] }}
 */
export function splitByMe(workshops, selfId) {
  const attended = [], taught = [];
  for (const w of workshops) (isTaught(w, selfId) ? taught : attended).push(w);
  return { attended, taught };
}

/**
 * How many days a workshop ran (1 with no end date).
 * @param {{ start_date: string, end_date: string | null }} workshop
 */
export function workshopDays({ start_date, end_date }) {
  if (!end_date) return 1;
  const day = (/** @type {string} */ date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  return Math.round((day(end_date) - day(start_date)) / 86_400_000) + 1;
}

/**
 * "Oct 3, 2026", or "Oct 3, 2026 – Oct 5, 2026".
 * @param {{ start_date: string, end_date: string | null }} workshop
 * @param {string} [locale]
 */
export function dateRangeText({ start_date, end_date }, locale) {
  if (!end_date || end_date === start_date) return formatDate(start_date, locale);
  if (end_date.slice(0, 4) !== start_date.slice(0, 4)) {
    return `${formatDate(start_date, locale)} – ${formatDate(end_date, locale)}`;
  }
  // Its spaces around the dash are thin ones: plain spaces, as elsewhere.
  return utcFormat(locale, true).formatRange(utcDate(start_date), utcDate(end_date)).replace(/\u2009/g, " ");
}

/** @param {string} iso YYYY-MM-DD */
function utcDate(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

/**
 * @param {string | undefined} locale
 * @param {boolean} withYear
 */
function utcFormat(locale, withYear) {
  return new Intl.DateTimeFormat(locale, { ...(withYear ? { year: "numeric" } : {}), month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * A workshop's dates as a card shows them, in two lines with no commas:
 * the days, then the year ("Nov 6–8" and "2026", "Oct 30–Nov 2" and
 * "2026"), or across years the start and the end ("Dec 30 2026–" and
 * "Jan 2 2027"). The first goes beside the title, the second on the line
 * under it. The browser's own range format, so other languages get theirs.
 * @param {{ start_date: string, end_date: string | null }} workshop
 * @param {string} [locale]
 * @returns {[string, string]}
 */
export function dateRangeLines({ start_date, end_date }, locale) {
  const plain = (/** @type {string} */ text) => text.replace(/,/g, "").replace(/\s*[–-]\s*/g, "–").replace(/\u2009/g, " ");
  if (end_date && end_date.slice(0, 4) !== start_date.slice(0, 4)) {
    return [`${plain(utcFormat(locale, true).format(utcDate(start_date)))}–`, plain(utcFormat(locale, true).format(utcDate(end_date)))];
  }
  const days = !end_date || end_date === start_date
    ? utcFormat(locale, false).format(utcDate(start_date))
    : utcFormat(locale, false).formatRange(utcDate(start_date), utcDate(end_date));
  return [plain(days), start_date.slice(0, 4)];
}

/**
 * "1 workshop", "3 workshops".
 * @param {number} count
 */
export function workshopCountText(count) {
  return count === 1 ? "1 workshop" : `${count} workshops`;
}

/** How many names the Summary's "most often" lines list. */
export const TOP_COUNT = 3;

/**
 * @typedef {{ name: string, count: number }} Ranked
 * @typedef {{ title: string, date: string }} Dated
 * @typedef {{
 *   workshops: number,
 *   days: number,
 *   locations: number,
 *   partners: number,
 *   educators: number,
 *   attendees: number,
 *   averageRating: number | null,
 *   topEducators: Ranked[],
 *   topTags: Ranked[],
 *   first: Dated | null,
 *   latest: Dated | null,
 *   money: { currency: string, minor: number, count: number }[],
 *   averageMoney: { currency: string, minor: number } | null,
 * }} Summary
 *   educators: everyone who taught them, not counting me (for the ones I
 *   taught: my co-teachers); partners: participants, not counting me;
 *   attendees: the attendee counts added up; locations: the different
 *   locations (deleted ones not counted); money: their costs (spent, on ones
 *   I attended; earned, on ones I taught) added up per currency, never
 *   converted, the most used first; averageMoney: in that currency, over
 *   the ones with a cost in it
 */

/**
 * The Summary card's numbers for some workshops.
 * @param {Workshop[]} workshops
 * @param {string | null} selfId
 * @returns {Summary}
 */
export function summarise(workshops, selfId) {
  /** @param {WorkshopPerson[]} people */
  const others = (people) => people.filter((p) => p.person_id !== null && p.person_id !== selfId);
  const educators = new Map(), partners = new Set(), locations = new Set();
  /** @type {Map<string, Ranked>} */
  const tags = new Map();
  let days = 0, attendees = 0, ratingTotal = 0, rated = 0;

  for (const w of workshops) {
    days += workshopDays(w);
    attendees += w.attendee_count ?? 0;
    if (typeof w.rating === "number") {
      ratingTotal += w.rating;
      rated++;
    }
    if (w.location_id) locations.add(w.location_id);
    for (const p of others(w.participants)) partners.add(p.person_id);
    for (const p of others(w.educators)) {
      const seen = educators.get(p.person_id) ?? { name: p.person_name ?? "", count: 0 };
      seen.count++;
      educators.set(p.person_id, seen);
    }
    for (const name of w.tags) {
      const key = name.toLocaleLowerCase();
      const seen = tags.get(key) ?? { name, count: 0 };
      seen.count++;
      tags.set(key, seen);
    }
  }

  const byDate = [...workshops].sort((a, b) => a.start_date.localeCompare(b.start_date));
  /** @param {Workshop | undefined} w @returns {Dated | null} */
  const dated = (w) => (w ? { title: w.title, date: w.start_date } : null);
  return {
    workshops: workshops.length,
    days,
    locations: locations.size,
    partners: partners.size,
    educators: educators.size,
    attendees,
    averageRating: rated ? Math.round((ratingTotal / rated) * 10) / 10 : null,
    topEducators: ranked([...educators.values()]),
    topTags: ranked([...tags.values()]),
    first: dated(byDate[0]),
    latest: dated(byDate[byDate.length - 1]),
    ...moneyOf(workshops),
  };
}

/**
 * Costs added up per currency, and the average in the most used.
 * @param {Record<string, any>[]} workshops opened
 */
export function moneyOf(workshops) {
  const money = totalsByCurrency(workshops.map((w) => w.cost));
  const main = money[0];
  return { money, averageMoney: main ? { currency: main.currency, minor: Math.round(main.minor / main.count) } : null };
}

/**
 * The most frequent first (then A–Z), up to TOP_COUNT.
 * @param {Ranked[]} list
 */
function ranked(list) {
  return [...list].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, TOP_COUNT);
}
