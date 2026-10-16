// The Insights view's time periods: which dates each covers, the arrows that
// step through them, and how the tie count chart splits them into bars.
// Pure, so it's easy to test. Dates are "YYYY-MM-DD" strings throughout,
// worked on as UTC days so the viewer's time zone can't shift them.

/**
 * @typedef {"year" | "month" | "last365" | "last4w" | "all" | "custom"} Period
 * @typedef {{ period: Period, anchor: string, from: string, to: string }} PeriodState
 *   anchor: a day in the year or month shown (Year and Month); from / to:
 *   the Custom range ("" when not chosen yet)
 * @typedef {{ from: string | null, to: string | null }} DateRange null: open-ended
 * @typedef {"day" | "month" | "year"} BucketUnit
 * @typedef {{ key: string, label: string, title: string, count: number, tieIds: string[] }} Bucket
 *   key: the day, "YYYY-MM" or "YYYY"; label: under the bar; title: in full,
 *   for screen readers and the tooltip
 */

/** @type {{ value: Period, label: string }[]} */
export const PERIODS = [
  { value: "year", label: "Year" },
  { value: "month", label: "Month" },
  { value: "last365", label: "Last 365 days" },
  { value: "last4w", label: "Last 4 weeks" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
// A custom range longer than this is shown a month to a bar.
const MAX_DAY_BARS = 42;

/** @param {string} date "YYYY-MM-DD" */
function toMs(date) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** @param {number} ms */
function toDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * @param {string} date
 * @param {number} days
 */
export function addDays(date, days) {
  return toDate(toMs(date) + days * DAY_MS);
}

/** Days from a to b (b - a). @param {string} a @param {string} b */
function daysBetween(a, b) {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

/** @param {number} year @param {number} month 1–12 */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** @param {number} n */
const pad = (n) => String(n).padStart(2, "0");

/**
 * Where the view starts: this year.
 * @param {string} today
 * @returns {PeriodState}
 */
export function initialPeriod(today) {
  return { period: "year", anchor: today, from: "", to: "" };
}

/**
 * The dates a period covers. All time and an unfinished Custom range are
 * open at one or both ends.
 * @param {PeriodState} state
 * @param {string} today
 * @returns {DateRange}
 */
export function periodRange(state, today) {
  const [y, m] = state.anchor.split("-").map(Number);
  switch (state.period) {
    case "year": return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "month": return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}` };
    case "last365": return { from: addDays(today, -364), to: today };
    case "last4w": return { from: addDays(today, -27), to: today };
    case "all": return { from: null, to: null };
    case "custom": return { from: state.from || null, to: state.to || null };
  }
}

/**
 * Whether the back and forward arrows step through the period (a year or a
 * month at a time).
 * @param {Period} period
 */
export function canStep(period) {
  return period === "year" || period === "month";
}

/**
 * The year or month before (-1) or after (+1).
 * @param {PeriodState} state
 * @param {-1 | 1} direction
 * @returns {PeriodState}
 */
export function stepPeriod(state, direction) {
  const [y, m] = state.anchor.split("-").map(Number);
  if (state.period === "year") return { ...state, anchor: `${y + direction}-01-01` };
  if (state.period === "month") {
    const date = new Date(Date.UTC(y, m - 1 + direction, 1));
    return { ...state, anchor: toDate(date.getTime()) };
  }
  return state;
}

/**
 * "2026", "October 2026", "Last 365 days"…
 * @param {PeriodState} state
 * @param {string} [locale]
 */
export function periodTitle(state, locale) {
  const [y, m] = state.anchor.split("-").map(Number);
  switch (state.period) {
    case "year": return String(y);
    case "month": return monthTitle(y, m, locale);
    case "custom": {
      if (!state.from && !state.to) return "Choose dates";
      const show = (/** @type {string} */ d) => new Date(toMs(d)).toLocaleDateString(locale, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
      if (!state.to) return `From ${show(state.from)}`;
      if (!state.from) return `Until ${show(state.to)}`;
      return `${show(state.from)} – ${show(state.to)}`;
    }
    default: return PERIODS.find((p) => p.value === state.period)?.label ?? "";
  }
}

/**
 * "October 2026".
 * @param {number} year
 * @param {number} month 1–12
 * @param {string} [locale]
 */
export function monthTitle(year, month, locale) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, { timeZone: "UTC", year: "numeric", month: "long" });
}

/**
 * A bar per month for a year or the last 365 days; per day for a month or
 * the last 4 weeks. All time: per year, or per month while there's less than
 * a year of ties. Custom: per day up to six weeks, then per month.
 * @param {Period} period
 * @param {{ from: string, to: string }} span the dates the chart covers (chartSpan)
 * @returns {BucketUnit}
 */
export function bucketUnit(period, span) {
  switch (period) {
    case "year": case "last365": return "month";
    case "month": case "last4w": return "day";
    case "all": return daysBetween(span.from, span.to) < 365 ? "month" : "year";
    case "custom": return daysBetween(span.from, span.to) + 1 > MAX_DAY_BARS ? "month" : "day";
  }
}

/**
 * The dates the chart runs across: the period's, with an open end filled in
 * from the ties (the first one) or today (the end, or the last tie if it's
 * later).
 * @param {DateRange} range
 * @param {{ tie_date: string }[]} ties oldest first
 * @param {string} today
 */
export function chartSpan(range, ties, today) {
  const first = ties[0]?.tie_date ?? today;
  const last = ties.at(-1)?.tie_date ?? today;
  const from = range.from ?? (first < today ? first : today);
  const to = range.to ?? (last > today ? last : today);
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * The bars: one per day, month or year across the span, counting the ties
 * in each (and keeping their ids, for showing them later).
 * @param {BucketUnit} unit
 * @param {{ from: string, to: string }} span
 * @param {{ id: string, tie_date: string }[]} ties
 * @param {string} [locale]
 * @returns {Bucket[]}
 */
export function buckets(unit, span, ties, locale) {
  /** @type {Bucket[]} */
  const bars = [];
  const [fy, fm] = span.from.split("-").map(Number);
  const [ty, tm] = span.to.split("-").map(Number);
  if (unit === "day") {
    for (let d = span.from; d <= span.to; d = addDays(d, 1)) {
      const title = new Date(toMs(d)).toLocaleDateString(locale, { timeZone: "UTC", month: "long", day: "numeric" });
      bars.push({ key: d, label: String(Number(d.slice(8))), title, count: 0, tieIds: [] });
    }
  } else if (unit === "month") {
    for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, m = 1) : m++) {
      const date = new Date(Date.UTC(y, m - 1, 1));
      const label = date.toLocaleDateString(locale, { timeZone: "UTC", month: "short" });
      bars.push({ key: `${y}-${pad(m)}`, label, title: monthTitle(y, m, locale), count: 0, tieIds: [] });
    }
  } else {
    for (let y = fy; y <= ty; y++) bars.push({ key: String(y), label: String(y), title: String(y), count: 0, tieIds: [] });
  }

  const keyLength = unit === "day" ? 10 : unit === "month" ? 7 : 4;
  const byKey = new Map(bars.map((bar) => [bar.key, bar]));
  for (const tie of ties) {
    const bar = byKey.get(tie.tie_date.slice(0, keyLength));
    if (bar) {
      bar.count++;
      bar.tieIds.push(tie.id);
    }
  }
  return bars;
}

/**
 * A month as the calendar draws it: how many blank days come before the
 * 1st (weeks start on Sunday) and how many days it has.
 * @param {number} year
 * @param {number} month 1–12
 */
export function monthGrid(year, month) {
  return { lead: new Date(Date.UTC(year, month - 1, 1)).getUTCDay(), days: daysInMonth(year, month) };
}

/**
 * The first and last day of the month a date is in.
 * @param {string} date
 * @returns {{ from: string, to: string }}
 */
export function monthRange(date) {
  const [y, m] = date.split("-").map(Number);
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}` };
}
