// Analytics view: a period's numbers and charts, for ties where I was in the
// chosen role, narrowed by people, locations and tags from "More filters".
// (The month calendar is its own view: views/calendar.js.)
//
// The server sends just the ties (POST /api/stats/ties); stats.js and
// stats-period.js do the counting here. Tapping a bar, partner, slice or
// map pin lists the ties behind it (tie-list-dialog.js). The map's code and
// country outlines (world-map.js) load only when its card is about to
// scroll into view, so they cost nothing to anyone who doesn't scroll down.

import { roleName, roleOptions } from "../roles.js";
import { api, errorMessage } from "../api.js";
import { h, $, infoTip } from "../dom.js";
import { today as todayIn } from "../format.js";
import { multiSelect } from "../multi-select.js";
import { hankIcon } from "../rope-rating.js";
import { barChart, partnerBars, pieChart, rankBars, roleKey, stat, TYPE_COLORS } from "../charts.js";
import { tiesWord } from "../chart-parts.js";
import { openTieList } from "../tie-list-dialog.js";
import { mapPlaces } from "../map-geo.js";
import { open } from "../vault.js";
import { formatMoney } from "../currency.js";
import { dateRangeText } from "../workshops-view.js";
import { workshopsIn, followUps, workshopNumbers, practisedMost, workshopsByBar, workshopPlaces } from "../workshop-stats.js";
import {
  summarize, topPartners, typeShares, weekdayShares, locationShares, percent, formatTotalTime, tieListHeading,
  roleChartTies, withSegments, SEGMENTS,
} from "../stats.js";
import {
  PERIODS, initialPeriod, periodRange, canStep, stepPeriod, periodTitle, bucketUnit, chartSpan, buckets,
} from "../stats-period.js";

/**
 * @typedef {import("../stats.js").StatsTie} StatsTie
 * @typedef {import("../stats-period.js").PeriodState} PeriodState
 * @typedef {typeof import("../world-map.js")} WorldMapModule
 * @typedef {{ person_ids: string[], location_ids: string[], tag_ids: string[] }} MoreFilters
 */

/**
 * The role filter: my role on the tie, as I call it (src/stats/parse.js
 * has the same values; self tie is self_tie there).
 */
function roleChoices() {
  return [
    { value: "all", label: "All roles" },
    ...roleOptions().map((r) => ({ value: r.value.replace(" ", "_"), label: `As ${roleName(r.value)}` })),
  ];
}
const TOP_PARTNERS = 10;
const TOP_LOCATIONS = 9;
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
 * @param {{ signal: AbortSignal }} context
 */
export function mount(_root, { signal }) {
  const today = todayIn();
  // The Workshops card's ? (tap, or hover with a mouse): what its numbers count.
  const workshopsTip = infoTip("workshops-info", "About these numbers",
    "Follow-up ties are on a plan linked to a workshop; ties at the workshop itself aren't counted. " +
    "Workshops follow the time period only: the role and More filters are for ties.");
  $("#workshops-header").append(workshopsTip.button);
  $("#workshops-header").after(workshopsTip.text);
  // Only the newest answer is shown, if the filters change quickly.
  let insightsRequest = 0;

  // --- The map, loaded when its card comes near ---
  /** @type {WorldMapModule | null} */
  let mapModule = null;
  let mapFailed = false;
  /** @type {StatsTie[] | null} the ties last drawn, for when the map loads */
  let shownTies = null;
  /** Ends the map on screen (its size watcher) when it's replaced. */
  let mapDrawn = new AbortController();
  signal.addEventListener("abort", () => mapDrawn.abort());
  const nearMap = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    nearMap.disconnect();
    import("../world-map.js").then((module) => {
      if (signal.aborted) return;
      mapModule = module;
      if (shownTies) drawMap(shownTies);
    }, () => {
      mapFailed = true;
      if (shownTies) drawMap(shownTies);
    });
  }, { rootMargin: "400px 0px" });
  nearMap.observe($("#map-card"));
  signal.addEventListener("abort", () => nearMap.disconnect());

  // --- Workshops: all of mine, my plans (their links and ties) and the
  // locations' coordinates, loaded once; each period picks its own. ---
  /** @type {{ workshops: any[], plans: any[], locations: any[], selfId: string | null } | null} */
  let learning = null;
  // Workshops are extras here: if they can't load, the ties still show.
  const loadLearning = () => Promise.all([
    api("/api/workshops").then((rows) => open("workshop", rows)),
    api("/api/plans?archived=all"),
    api("/api/locations?archived=all"),
    api("/api/people?archived=false"),
  ]).then(([workshops, plans, locations, people]) => {
    learning = { workshops, plans, locations, selfId: people.find((/** @type {any} */ p) => p.is_self)?.id ?? null };
  }, () => { learning = null; });
  let learningLoaded = loadLearning();

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
  roleSelect.replaceChildren(...roleChoices().map((r) => h("option", { value: r.value }, r.label)));
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
      [ties] = await Promise.all([fetchTies(requestBody(filters)), learningLoaded]);
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
      // Down the left column, then the right (.stat-pairs fills columns).
      stat("Ties", String(s.ties)),
      stat("Partners", String(s.partners)),
      stat("Locations", String(s.locations)),
      stat(`As ${roleName("top")}`, String(s.asTop), `${percent(s.asTop, s.ties)}%`),
      stat("Time (total)", formatTotalTime(s.minutes)),
      stat("Time (avg)", s.avgMinutes === null ? "–" : `${s.avgMinutes}m`),
      ratingStat(s.avgRating),
      stat(`As ${roleName("bottom")}`, String(s.asBottom), `${percent(s.asBottom, s.ties)}%`));

    const empty = () => h("p", { className: "empty" }, "No ties in this period.");
    const span = chartSpan(periodRange(period, today), ties, today);
    const unit = bucketUnit(period.period, span);
    const per = unit === "day" ? "day" : unit === "month" ? "month" : "year";
    /** @param {{ label: string, tieIds: string[] }} slice */
    const pick = (slice) => showTies(slice.label, slice.tieIds);

    // Tie count and partners: split by my role (or grey, with the filter on
    // spotter or photographer), counting only ties where I was in one.
    const byRole = roleChartTies(ties, role);
    const countBars = withSegments(buckets(unit, span, byRole.ties), byRole.ties, byRole.segmentOf);
    const shownParts = SEGMENTS.filter((key) => countBars.some((bar) => bar.segments.some((part) => part.key === key)));
    const noRoleTies = () => h("p", { className: "empty" },
      `No ties as ${roleName("top")}, ${roleName("bottom")} or self tie in this period.`);
    const periodWorkshops = learning ? workshopsIn(learning.workshops, periodRange(period, today)) : [];
    // A cap over each bar a workshop started in.
    const marks = workshopsByBar(countBars, periodWorkshops).map((list, i) => (list.length
      ? { label: `${countBars[i].title}: ${workshopsWord(list.length)}`, onPick: () => showWorkshops(countBars[i].title, list) }
      : null));
    $("#tie-count-chart").replaceChildren(...(byRole.ties.length
      ? [roleKey(shownParts), barChart(countBars, `Ties each ${per}`, (bar) => showTies(bar.title, bar.tieIds), marks)]
      : [ties.length ? noRoleTies() : empty()]));
    drawWorkshops(periodWorkshops, ties);
    const partners = withSegments(topPartners(byRole.ties, TOP_PARTNERS), byRole.ties, byRole.segmentOf);
    $("#partner-chart").replaceChildren(...(partners.length
      ? [roleKey(shownParts), partnerBars(partners, pick)]
      : [h("p", { className: "empty" }, "No partners in this period.")]));

    $("#type-chart").replaceChildren(ties.length
      ? pieChart(typeShares(ties), "Ties by type", pick, (slice) => TYPE_COLORS[slice.key] ?? "c-grey") : empty());
    $("#weekday-chart").replaceChildren(ties.length
      ? barChart(weekdayShares(ties).map((day) => ({ ...day, title: day.label })), "Ties by day of the week", pick) : empty());
    $("#location-chart").replaceChildren(ties.length ? rankBars(locationShares(ties, TOP_LOCATIONS), "Ties by location", pick) : empty());
    shownTies = ties;
    shownWorkshops = periodWorkshops;
    drawMap(ties);
  }

  /** The period's workshops, for the map. @type {any[]} */
  let shownWorkshops = [];

  /**
   * The Workshops card and Practiced most: hidden until there are any
   * workshops at all.
   * @param {any[]} workshops the period's
   * @param {StatsTie[]} ties the period's, as filtered
   */
  function drawWorkshops(workshops, ties) {
    const any = !!learning?.workshops.length;
    $("#workshops-card").hidden = !any;
    $("#practised-card").hidden = !any;
    if (!learning || !any) return;
    const follow = followUps(learning.workshops, learning.plans);
    const n = workshopNumbers(workshops, follow, ties, learning.selfId);
    $("#workshop-stats").replaceChildren(
      // Down the left column, then the right (.stat-pairs fills columns).
      stat("Attended", String(n.attended)),
      stat("Taught", String(n.taught)),
      stat("Days", String(n.days)),
      moneyStat("Spent", n.spend),
      moneyStat("Earned", n.earned),
      stat("Follow-up ties", String(n.followUps), `${n.followUpShare}%`));
    const ranked = practisedMost(workshops, follow);
    $("#practised-chart").replaceChildren(ranked.length
      ? rankBars(ranked.map((w) => ({ key: w.id, label: w.title, count: w.tieIds.length, tieIds: w.tieIds })),
        "Workshops by follow-up ties", (/** @type {any} */ slice) => showTies(slice.label, slice.tieIds))
      : h("p", { className: "empty" }, workshops.length
        ? "No follow-up ties yet: link a plan to a workshop, then tie it."
        : "No workshops in this period."));
  }

  /**
   * Money per currency, never converted: the most used as the number, the
   * others in small type under it.
   * @param {string} label
   * @param {{ currency: string, minor: number }[]} totals
   */
  function moneyStat(label, totals) {
    const [main, ...rest] = totals;
    return stat(label, main ? formatMoney(main.minor, main.currency) : "–",
      rest.length ? `+ ${rest.map((t) => formatMoney(t.minor, t.currency)).join(" · ")}` : undefined);
  }

  /** @param {number} count */
  function workshopsWord(count) {
    return `${count} workshop${count === 1 ? "" : "s"}`;
  }

  /**
   * Lists some workshops; each opens in its form.
   * @param {string} heading
   * @param {any[]} workshops
   */
  function showWorkshops(heading, workshops) {
    const dialog = h("dialog", { className: "form-dialog workshop-list-dialog", "aria-labelledby": "workshop-list-heading" },
      h("h2", { id: "workshop-list-heading" }, `${heading}: ${workshopsWord(workshops.length)}`),
      workshops.map((w) => h("button", {
        type: "button", className: "linked-row", onclick: async () => {
          dialog.close();
          const { editWorkshop } = await import("../workshop-form.js");
          if (await editWorkshop(w.id)) {
            learningLoaded = loadLearning();
            loadInsights();
          }
        },
      }, h("span", { className: "item-title" }, w.title), h("span", { className: "item-meta" }, dateRangeText(w)))),
      h("button", { type: "button", className: "dialog-cancel", onclick: () => dialog.close() }, "Close"));
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  /**
   * The map's pins for these ties, and how many of them it leaves out
   * (without a location with coordinates). Waits for the map to load.
   * @param {StatsTie[]} ties
   */
  function drawMap(ties) {
    const { places, shown, total } = mapPlaces(ties);
    const count = $("#map-count");
    count.textContent = `Showing ${shown} of ${tiesWord(total)}.`;
    count.hidden = shown === total || !places.length;
    const chart = $("#map-chart");
    if (!places.length) {
      chart.replaceChildren(h("p", { className: "empty" }, ties.length
        ? "No ties at a location with coordinates in this period." : "No ties in this period."));
      return;
    }
    if (!mapModule) {
      chart.replaceChildren(mapFailed
        ? h("p", { className: "message error" }, "Couldn't load the map. Check your connection and open Analytics again.")
        : h("p", { className: "empty" }, "Loading the map…"));
      return;
    }
    mapDrawn.abort();
    mapDrawn = new AbortController();
    const byId = new Map((learning?.workshops ?? []).map((w) => [w.id, w]));
    chart.replaceChildren(mapModule.worldMap({
      places, signal: mapDrawn.signal, onPick: (pin) => showTies(pin.label, pin.tieIds),
      workshops: learning ? workshopPlaces(shownWorkshops, learning.locations) : [],
      onPickWorkshop: (place) => showWorkshops(place.label, place.workshopIds.map((id) => byId.get(id))),
    }));
  }

  /** @param {number | null} rating */
  function ratingStat(rating) {
    const icon = hankIcon();
    icon.classList.add("filled", "stat-hank");
    return h("div", { className: "stat" },
      h("dt", {}, "Avg rating"),
      h("dd", {}, rating === null ? "–" : String(rating), rating === null ? null : icon));
  }

  /**
   * Lists the ties behind a bar, partner or slice.
   * @param {string} label
   * @param {string[]} tieIds
   */
  function showTies(label, tieIds) {
    openTieList({ heading: tieListHeading(label, tieIds.length), tieIds, onChange: loadInsights });
  }

  loadInsights();
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
