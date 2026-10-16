// Analytics view: two tabs. Calendar shows one month (this one to start),
// with a rope hank on each day with a tie and the month's numbers above it.
// Insights shows a period's numbers and charts, for ties where I was in the
// chosen role, narrowed by people, locations and tags from "More filters".
//
// The server sends just the ties (POST /api/stats/ties); stats.js and
// stats-period.js do the counting here. Each bar, slice and day keeps the
// ids of its ties, for showing them when tapped (planned: considerations.md).

import { api, errorMessage } from "../api.js";
import { h, $ } from "../dom.js";
import { today as todayIn } from "../format.js";
import { multiSelect } from "../multi-select.js";
import { hankIcon } from "../rope-rating.js";
import { barChart, partnerBars, pieChart } from "../charts.js";
import {
  summarize, topPartners, typeShares, weekdayShares, locationShares, tiesByDay, percent, formatTotalTime,
} from "../stats.js";
import {
  PERIODS, initialPeriod, periodRange, canStep, stepPeriod, periodTitle, bucketUnit, chartSpan, buckets,
  monthGrid, monthRange, monthTitle,
} from "../stats-period.js";

/**
 * @typedef {import("../stats.js").StatsTie} StatsTie
 * @typedef {import("../stats-period.js").PeriodState} PeriodState
 * @typedef {{ person_ids: string[], location_ids: string[], tag_ids: string[] }} MoreFilters
 */

/** The role filter: Self's role on the tie (src/stats/parse.js has the same names). */
const ROLE_CHOICES = [
  { value: "all", label: "All roles" },
  { value: "top", label: "As top / rigger" },
  { value: "bottom", label: "As bottom / model" },
  { value: "spotter", label: "As spotter" },
  { value: "photographer", label: "As photographer" },
];
const TOP_PARTNERS = 10;
const TOP_LOCATIONS = 4;
const WEEKDAY_HEADINGS = ["S", "M", "T", "W", "T", "F", "S"];
/** @type {MoreFilters} */
const NO_FILTERS = { person_ids: [], location_ids: [], tag_ids: [] };

/**
 * @param {Record<string, unknown>} body
 * @returns {Promise<StatsTie[]>}
 */
async function fetchTies(body) {
  return (await api("/api/stats/ties", { method: "POST", body })).ties;
}

/**
 * @param {HTMLElement} _root the view's element
 * @param {{ signal: AbortSignal }} _context
 */
export function mount(_root, _context) {
  const today = todayIn();
  // Only the newest answer to each panel's requests is shown.
  let calendarRequest = 0;
  let insightsRequest = 0;

  // --- the tabs ---
  const calendarTab = $("#tab-calendar");
  const insightsTab = $("#tab-insights");
  const calendarPanel = $("#calendar-panel");
  const insightsPanel = $("#insights-panel");
  let insightsLoaded = false;

  /** @param {"calendar" | "insights"} tab */
  function showTab(tab) {
    calendarTab.setAttribute("aria-pressed", String(tab === "calendar"));
    insightsTab.setAttribute("aria-pressed", String(tab === "insights"));
    calendarPanel.hidden = tab !== "calendar";
    insightsPanel.hidden = tab !== "insights";
    if (tab === "insights" && !insightsLoaded) {
      insightsLoaded = true;
      loadInsights();
    }
  }
  calendarTab.addEventListener("click", () => showTab("calendar"));
  insightsTab.addEventListener("click", () => showTab("insights"));

  // --- Calendar ---
  let month = today;
  $("#cal-prev").addEventListener("click", () => { month = stepPeriod({ ...initialPeriod(month), period: "month" }, -1).anchor; loadCalendar(); });
  $("#cal-next").addEventListener("click", () => { month = stepPeriod({ ...initialPeriod(month), period: "month" }, 1).anchor; loadCalendar(); });

  async function loadCalendar() {
    const id = ++calendarRequest;
    const [y, m] = month.split("-").map(Number);
    $("#cal-title").textContent = monthTitle(y, m);
    const message = $("#cal-message");
    message.textContent = "";
    /** @type {StatsTie[]} */
    let ties;
    try {
      ties = await fetchTies(monthRange(month));
    } catch (err) {
      if (id === calendarRequest) message.textContent = "Couldn't load this month: " + errorMessage(err);
      return;
    }
    if (id !== calendarRequest) return;
    const s = summarize(ties);
    $("#cal-stats").replaceChildren(
      stat("Ties", String(s.ties)),
      stat("Partners", String(s.partners)),
      stat("Locations", String(s.locations)),
      stat("As top / rigger", String(s.asTop), `${percent(s.asTop, s.ties)}%`),
      stat("As bottom / model", String(s.asBottom), `${percent(s.asBottom, s.ties)}%`));
    drawMonth(y, m, tiesByDay(ties));
  }

  /**
   * @param {string} label
   * @param {string} value
   * @param {string} [extra] e.g. a percentage, after the value
   */
  function stat(label, value, extra) {
    return h("div", { className: "stat" },
      h("dt", {}, label),
      h("dd", {}, value, extra ? h("span", { className: "stat-extra" }, extra) : null));
  }

  /**
   * The month as a grid of days, weeks starting on Sunday. A day with ties
   * shows a hank, with the count on it when there's more than one.
   * @param {number} y
   * @param {number} m
   * @param {Map<string, string[]>} days
   */
  function drawMonth(y, m, days) {
    const { lead, days: count } = monthGrid(y, m);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h("li", { className: "cal-blank", "aria-hidden": "true" }));
    for (let d = 1; d <= count; d++) {
      const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const tieIds = days.get(date) ?? [];
      const icon = tieIds.length ? hankIcon() : null;
      icon?.classList.add("filled");
      const when = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "long", day: "numeric" });
      cells.push(h("li", {
        className: ["cal-day", tieIds.length ? "has-ties" : "", date === today ? "today" : ""].filter(Boolean).join(" "),
        "aria-label": tieIds.length ? `${when}: ${tieIds.length === 1 ? "1 tie" : `${tieIds.length} ties`}` : when,
        "aria-current": date === today ? "date" : null,
      },
      h("span", { className: "cal-num", "aria-hidden": "true" }, String(d)),
      icon ? h("span", { className: "cal-mark", "aria-hidden": "true" }, icon,
        tieIds.length > 1 ? h("span", { className: "cal-count" }, String(tieIds.length)) : null) : null));
    }
    $("#calendar").replaceChildren(
      h("ol", { className: "cal-weekdays", "aria-hidden": "true" }, WEEKDAY_HEADINGS.map((d) => h("li", {}, d))),
      h("ol", { className: "cal-days" }, cells));
  }

  // --- Insights ---
  /** @type {PeriodState} */
  let period = initialPeriod(today);
  let role = "all";
  /** @type {MoreFilters} */
  let filters = NO_FILTERS;

  /** @type {HTMLSelectElement} */
  const periodSelect = $("#period");
  periodSelect.replaceChildren(...PERIODS.map((p) => h("option", { value: p.value }, p.label)));
  /** @type {HTMLSelectElement} */
  const roleSelect = $("#role");
  roleSelect.replaceChildren(...ROLE_CHOICES.map((r) => h("option", { value: r.value }, r.label)));
  /** @type {HTMLInputElement} */
  const fromInput = $("#insights-from");
  /** @type {HTMLInputElement} */
  const toInput = $("#insights-to");

  periodSelect.addEventListener("change", () => {
    const value = /** @type {PeriodState["period"]} */ (periodSelect.value);
    // Back to this year or month when switching to them.
    period = { ...period, period: value, anchor: today };
    loadInsights();
  });
  roleSelect.addEventListener("change", () => { role = roleSelect.value; loadInsights(); });
  fromInput.addEventListener("change", () => { period = { ...period, from: fromInput.value }; loadInsights(); });
  toInput.addEventListener("change", () => { period = { ...period, to: toInput.value }; loadInsights(); });
  $("#period-prev").addEventListener("click", () => { period = stepPeriod(period, -1); loadInsights(); });
  $("#period-next").addEventListener("click", () => { period = stepPeriod(period, 1); loadInsights(); });
  $("#more-filters").addEventListener("click", async () => {
    const chosen = await openMoreFilters(filters, (draft) => fetchTies(requestBody(draft)));
    if (chosen) { filters = chosen; loadInsights(); }
  });

  /**
   * @param {MoreFilters} more
   * @returns {Record<string, unknown>}
   */
  function requestBody(more) {
    return { ...periodRange(period, today), role, ...more };
  }

  function showControls() {
    periodSelect.value = period.period;
    roleSelect.value = role;
    const custom = period.period === "custom";
    $("#custom-dates").hidden = !custom;
    fromInput.value = period.from;
    toInput.value = period.to;
    // Stops a backwards date range being picked.
    fromInput.max = period.to;
    toInput.min = period.from;
    const stepping = canStep(period.period);
    $("#period-prev").hidden = !stepping;
    $("#period-next").hidden = !stepping;
    $("#period-prev").setAttribute("aria-label", period.period === "year" ? "Previous year" : "Previous month");
    $("#period-next").setAttribute("aria-label", period.period === "year" ? "Next year" : "Next month");
    $("#period-title").textContent = periodTitle(period);
    const count = filters.person_ids.length + filters.location_ids.length + filters.tag_ids.length;
    const badge = $("#filter-count");
    badge.textContent = String(count);
    badge.hidden = count === 0;
    $("#more-filters").setAttribute("aria-label", count ? `More filters (${count} chosen)` : "More filters");
  }

  async function loadInsights() {
    showControls();
    const id = ++insightsRequest;
    const message = $("#insights-message");
    message.textContent = "";
    /** @type {StatsTie[]} */
    let ties;
    try {
      ties = await fetchTies(requestBody(filters));
    } catch (err) {
      if (id === insightsRequest) message.textContent = "Couldn't load the numbers: " + errorMessage(err);
      return;
    }
    if (id !== insightsRequest) return;
    drawInsights(ties);
  }

  /** @param {StatsTie[]} ties */
  function drawInsights(ties) {
    const s = summarize(ties);
    $("#insights-stats").replaceChildren(
      stat("Ties", String(s.ties)),
      stat("Time", formatTotalTime(s.minutes), s.avgMinutes === null ? undefined : `${s.avgMinutes}m avg`),
      stat("Partners", String(s.partners)),
      stat("Days", String(s.days)),
      stat("Locations", String(s.locations)),
      ratingStat(s.avgRating),
      stat("As top / rigger", String(s.asTop), `${percent(s.asTop, s.ties)}%`),
      stat("As bottom / model", String(s.asBottom), `${percent(s.asBottom, s.ties)}%`));

    const empty = () => h("p", { className: "empty" }, "No ties in this period.");
    const span = chartSpan(periodRange(period, today), ties, today);
    const unit = bucketUnit(period.period, span);
    const per = unit === "day" ? "day" : unit === "month" ? "month" : "year";
    $("#tie-count-chart").replaceChildren(ties.length ? barChart(buckets(unit, span, ties), `Ties each ${per}`) : empty());
    const partners = topPartners(ties, TOP_PARTNERS);
    $("#partner-chart").replaceChildren(partners.length ? partnerBars(partners) : h("p", { className: "empty" }, "No partners in this period."));
    $("#type-chart").replaceChildren(ties.length ? pieChart(typeShares(ties), "Ties by type") : empty());
    $("#weekday-chart").replaceChildren(ties.length ? pieChart(weekdayShares(ties), "Ties by day of the week") : empty());
    $("#location-chart").replaceChildren(ties.length ? pieChart(locationShares(ties, TOP_LOCATIONS), "Ties by location") : empty());
  }

  /** @param {number | null} rating */
  function ratingStat(rating) {
    const icon = hankIcon();
    icon.classList.add("filled", "stat-hank");
    return h("div", { className: "stat" },
      h("dt", {}, "Avg rating"),
      h("dd", {}, rating === null ? "–" : String(rating), rating === null ? null : icon));
  }

  showTab("calendar");
  loadCalendar();
}

/**
 * The "More filters" dialog: people, locations and tags, each a search box
 * of checkboxes. Several in one box find ties with any of them; filters in
 * different boxes narrow together. The button at the bottom says how many
 * ties the choice finds. Resolves with the new filters, or null if closed
 * without applying.
 * @param {MoreFilters} current
 * @param {(draft: MoreFilters) => Promise<StatsTie[]>} preview
 * @returns {Promise<MoreFilters | null>}
 */
function openMoreFilters(current, preview) {
  return new Promise((resolve) => {
    /** @type {MoreFilters} */
    let draft = { ...current };
    /** @type {MoreFilters | null} */
    let result = null;
    let previewRequest = 0;

    const people = multiSelect({ labelledBy: "af-people-label", placeholder: "Anyone", searchLabel: "Search people", onChange: (ids) => change({ person_ids: ids }) });
    const locations = multiSelect({ labelledBy: "af-locations-label", placeholder: "Anywhere", searchLabel: "Search locations", onChange: (ids) => change({ location_ids: ids }) });
    const tags = multiSelect({ labelledBy: "af-tags-label", placeholder: "Any tags", searchLabel: "Search tags", onChange: (ids) => change({ tag_ids: ids }) });
    const message = h("p", { className: "message", role: "status" });
    const apply = h("button", { type: "button", className: "primary", id: "af-apply", onclick: () => { result = draft; dialog.close(); } }, "Show ties");

    const dialog = h("dialog", { className: "form-dialog more-filters", "aria-labelledby": "af-heading" },
      h("h2", { id: "af-heading" }, "More filters"),
      h("p", { className: "hint" }, "Choosing several in one filter finds ties with any of them."),
      h("label", { id: "af-people-label" }, "People"), people.element,
      h("label", { id: "af-locations-label" }, "Locations"), locations.element,
      h("label", { id: "af-tags-label" }, "Has tags"), tags.element,
      message,
      h("div", { className: "dialog-buttons" },
        apply,
        h("button", { type: "button", id: "af-clear", onclick: () => {
          people.setSelected([]); locations.setSelected([]); tags.setSelected([]);
          change({ ...NO_FILTERS });
        } }, "Clear all"),
        h("button", { type: "button", id: "af-cancel", onclick: () => dialog.close() }, "Cancel")));
    dialog.addEventListener("close", () => { dialog.remove(); resolve(result); });

    /** @param {Partial<MoreFilters>} changes */
    async function change(changes) {
      draft = { ...draft, ...changes };
      const id = ++previewRequest;
      try {
        const ties = await preview(draft);
        if (id === previewRequest) apply.textContent = ties.length === 1 ? "Show 1 tie" : `Show ${ties.length} ties`;
      } catch (err) {
        if (id === previewRequest) message.textContent = "Couldn't count the ties: " + errorMessage(err);
      }
    }

    document.body.append(dialog);
    dialog.showModal();
    // Archived people and locations are included (in muted text): the
    // numbers cover your whole history. Not my own profile: every tie is mine.
    (async () => {
      try {
        const [peopleList, locationList, tagList] = await Promise.all([
          api("/api/people?archived=all"), api("/api/locations?archived=all"), api("/api/tags"),
        ]);
        /** @param {Record<string, any>} item */
        const option = (item) => ({ id: item.id, name: item.name, archived: !!item.archived_at });
        people.setOptions(peopleList.filter((/** @type {any} */ p) => !p.is_self).map(option));
        locations.setOptions(locationList.map(option));
        tags.setOptions(tagList.map(option));
        people.setSelected(draft.person_ids);
        locations.setSelected(draft.location_ids);
        tags.setSelected(draft.tag_ids);
        change({});
      } catch (err) {
        message.textContent = "Couldn't load people, locations and tags: " + errorMessage(err);
      }
    })();
  });
}
