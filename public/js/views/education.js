// Education view: workshops I attended and ones I taught. "Add a Workshop"
// opens the form in a dialog (workshop-form.js), as tapping a workshop's
// title does. One search, over all the workshops (loaded at once, their
// notes opened here), narrows all three tabs: Attended (my "this is me"
// profile isn't one of the educators), Taught (it is) and Summary.

import { errorMessage } from "../api.js";
import { h, $ } from "../dom.js";
import { multiSelect } from "../multi-select.js";
import { readAliases } from "../aliases.js";
import { pickTags } from "../tag-picker.js";
import { fitPeople } from "../tie-card.js";
import { hankIcon } from "../rope-rating.js";
import { formatDate } from "../format.js";
import { formatMoney } from "../currency.js";
import { openWorkshopForm, editWorkshop } from "../workshop-form.js";
import { workshopCard } from "../workshop-card.js";
import { WORKSHOP_SAVED } from "../nav.js";
import {
  EMPTY_SEARCH, TABS, hasWorkshopFilters, filterWorkshops, splitByMe, summarise, workshopCountText,
} from "../workshops-view.js";
import { listItems, listWorkshops } from "../store/index.js";

/** @typedef {import("../workshops-view.js").Workshop} Workshop */
/** @typedef {import("../workshops-view.js").WorkshopSearch} WorkshopSearch */
/** @typedef {typeof TABS[number]} Tab */

const KEYWORD_DELAY_MS = 300;

/**
 * @param {HTMLElement} _root
 * @param {{ signal: AbortSignal }} context
 */
export function mount(_root, { signal }) {
  const panel = $("#education-panel");
  /** @type {HTMLInputElement} */
  const keyword = $("#search-q");
  /** @type {HTMLInputElement} */
  const fromInput = $("#search-from");
  /** @type {HTMLInputElement} */
  const toInput = $("#search-to");
  /** @type {HTMLButtonElement} */
  const clearButton = $("#search-clear");
  const tagFilter = $("#search-tag-filter");
  const tagsAny = $("#search-tags-any");
  const tagsAll = $("#search-tags-all");
  const tabs = TABS.map((tab) => /** @type {HTMLButtonElement} */ ($(`#tab-${tab}`)));

  /** @type {Workshop[] | null} null until loaded */
  let workshops = null;
  /** @type {string | null} my "this is me" profile */
  let selfId = null;
  let selfIsEducator = false;
  /** @type {string | null} */
  let loadProblem = null;
  /** @type {WorkshopSearch} */
  let search = { ...EMPTY_SEARCH };
  /** @type {Tab} */
  let tab = "attended";

  const peopleFilter = multiSelect({
    labelledBy: "search-people-label", placeholder: "Anyone", searchLabel: "Search people",
    onChange: (ids) => update({ person_ids: ids }),
  });
  const educatorsFilter = multiSelect({
    labelledBy: "search-educators-label", placeholder: "Anyone", searchLabel: "Search educators",
    onChange: (ids) => update({ educator_ids: ids }),
  });
  const locationsFilter = multiSelect({
    labelledBy: "search-locations-label", placeholder: "Anywhere", searchLabel: "Search locations",
    onChange: (ids) => update({ location_ids: ids }),
  });
  $("#search-people").append(peopleFilter.element);
  $("#search-educators").append(educatorsFilter.element);
  $("#search-locations").append(locationsFilter.element);

  /** @param {Partial<WorkshopSearch>} changes */
  function update(changes) {
    search = { ...search, ...changes };
    fromInput.max = search.to;
    toInput.min = search.from;
    clearButton.hidden = !hasWorkshopFilters(search);
    render();
  }

  /** The chosen tags (each with × to remove it) and the OR / AND toggle. */
  function showTags() {
    tagsAny.setAttribute("aria-pressed", String(search.tag_match === "any"));
    tagsAll.setAttribute("aria-pressed", String(search.tag_match === "all"));
    tagFilter.replaceChildren(...search.tags.map((name) =>
      h("span", { className: "tag outline" }, name,
        h("button", {
          type: "button", className: "tag-x", "aria-label": `Remove ${name}`,
          onclick: () => { update({ tags: search.tags.filter((t) => t !== name) }); showTags(); },
        }, "×"))));
  }

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let keywordTimer;
  keyword.addEventListener("input", () => {
    clearTimeout(keywordTimer);
    keywordTimer = setTimeout(() => update({ q: keyword.value }), KEYWORD_DELAY_MS);
  });
  signal.addEventListener("abort", () => clearTimeout(keywordTimer));
  fromInput.addEventListener("change", () => update({ from: fromInput.value }));
  toInput.addEventListener("change", () => update({ to: toInput.value }));
  $("#search-tags-choose").addEventListener("click", async () => {
    const picked = await pickTags(search.tags, { forSearch: true, noun: "workshop" });
    if (picked === null) return;
    update({ tags: picked });
    showTags();
  });
  tagsAny.addEventListener("click", () => { update({ tag_match: "any" }); showTags(); });
  tagsAll.addEventListener("click", () => { update({ tag_match: "all" }); showTags(); });
  clearButton.addEventListener("click", () => {
    clearTimeout(keywordTimer);
    keyword.value = fromInput.value = toInput.value = "";
    peopleFilter.setSelected([]);
    educatorsFilter.setSelected([]);
    locationsFilter.setSelected([]);
    update({ ...EMPTY_SEARCH });
    showTags();
  });

  // The tabs: tap one, or move between them with the arrow keys.
  tabs.forEach((button, i) => {
    button.addEventListener("click", () => showTab(TABS[i]));
    button.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      next.click();
    });
  });

  /** @param {Tab} chosen */
  function showTab(chosen) {
    tab = chosen;
    tabs.forEach((button, i) => {
      const selected = TABS[i] === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", `tab-${tab}`);
    render();
  }

  $("#add-workshop").addEventListener("click", async () => {
    if (await openWorkshopForm()) load();
  });
  // A workshop added or changed from the poser opened on its own.
  document.addEventListener(WORKSHOP_SAVED, () => load(), { signal });

  /** @param {string} id */
  async function openWorkshop(id) {
    try {
      if (await editWorkshop(id)) load();
    } catch (err) {
      loadProblem = "Couldn't open the workshop: " + errorMessage(err);
      render();
    }
  }

  // Refit the people lines when the list's width changes.
  let fittedWidth = 0;
  const resized = new ResizeObserver(() => {
    if (panel.clientWidth === fittedWidth) return;
    fittedWidth = panel.clientWidth;
    fitPeople(panel);
  });
  resized.observe(panel);
  signal.addEventListener("abort", () => resized.disconnect());

  function render() {
    if (loadProblem) {
      panel.replaceChildren(h("p", { className: "message error" }, loadProblem));
      return;
    }
    if (!workshops) return;
    const all = splitByMe(workshops, selfId);
    const found = splitByMe(filterWorkshops(workshops, search), selfId);
    if (tab === "summary") {
      panel.replaceChildren(
        summaryCard("Attended", found.attended, false),
        summaryCard("Taught", found.taught, true));
      return;
    }
    const shown = found[tab];
    const total = all[tab].length;
    panel.replaceChildren(h("section", { className: "card" },
      h("div", { className: "card-header list-header" },
        h("h2", {}, tab === "taught" ? "Workshops taught" : "Workshops attended"),
        h("span", { className: "item-meta", id: "workshop-count" },
          hasWorkshopFilters(search) ? `Showing ${shown.length} of ${total}` : workshopCountText(total))),
      h("div", { id: "workshop-list" },
        shown.length ? shown.map((w) => workshopCard(w, openWorkshop, { taught: tab === "taught" })) : h("p", { className: "empty" }, emptyText(total)))));
    fitPeople(panel);
  }

  /** What an empty list says. @param {number} total how many the tab has without the search */
  function emptyText(total) {
    if (total) return "No workshops match the search.";
    if (tab === "attended") return "No workshops yet. Add one with the + above.";
    return selfIsEducator
      ? "Workshops with you as one of the educators show here."
      : "Workshops with you as one of the educators show here. Tick Educator on your own profile in People first.";
  }

  /**
   * One of the Summary's cards.
   * @param {string} title
   * @param {Workshop[]} list
   * @param {boolean} taught
   */
  function summaryCard(title, list, taught) {
    const s = summarise(list, selfId);
    /** @param {string} label @param {number} value */
    const stat = (label, value) => h("div", { className: "stat" }, h("dt", {}, label), h("dd", {}, value.toLocaleString()));
    /** @param {string} label @param {{ name: string, count: number }[]} ranked */
    const top = (label, ranked) => (ranked.length
      ? h("p", { className: "item-meta" }, `${label}: ${ranked.map((r) => `${r.name} (${r.count})`).join(", ")}`) : null);
    /** @param {string} label @param {{ title: string, date: string } | null} item */
    const dated = (label, item) => (item ? h("p", { className: "item-meta" }, `${label}: ${item.title}, ${formatDate(item.date)}`) : null);

    // Down the left column, then the right (.stat-pairs fills columns). A
    // workshop's cost is what I earned on one I taught, spent on one I attended.
    const stats = taught
      ? [stat("Workshops", s.workshops), stat("Days", s.days), stat("Attendees", s.attendees), stat("Co-teachers", s.educators),
        stat("Locations", s.locations), stat("Partners", s.partners), ratingStat(s.averageRating), moneyStat("Earned", s.money)]
      : [stat("Workshops", s.workshops), stat("Days", s.days), stat("Educators", s.educators), moneyStat("Total spend", s.money),
        stat("Locations", s.locations), stat("Partners", s.partners), ratingStat(s.averageRating),
        moneyStat("Avg per workshop", s.averageMoney ? [s.averageMoney] : [])];
    return h("section", { className: "card summary-card", id: `summary-${title.toLowerCase()}` },
      h("h2", {}, title),
      s.workshops === 0
        ? h("p", { className: "empty" }, hasWorkshopFilters(search) ? "No workshops match the search." : "No workshops yet.")
        : [
          h("dl", { className: "stat-pairs" }, stats),
          top(taught ? "Taught most with" : "Learned most from", s.topEducators),
          top("Top tags", s.topTags),
          dated("First", s.first),
          s.workshops > 1 ? dated("Latest", s.latest) : null,
        ]);
  }

  /**
   * Money added up per currency, never converted: the most used one as the
   * number, any others in small type under it ("+ €310 · £85").
   * @param {string} label
   * @param {{ currency: string, minor: number }[]} totals
   */
  function moneyStat(label, totals) {
    const [main, ...rest] = totals;
    return h("div", { className: "stat" },
      h("dt", {}, label),
      h("dd", {}, main ? formatMoney(main.minor, main.currency) : "–",
        rest.length ? h("span", { className: "stat-extra" }, `+ ${rest.map((t) => formatMoney(t.minor, t.currency)).join(" · ")}`) : null));
  }

  /** @param {number | null} rating */
  function ratingStat(rating) {
    const icon = hankIcon();
    icon.classList.add("filled", "stat-hank");
    return h("div", { className: "stat" },
      h("dt", {}, "Avg rating"),
      h("dd", {}, rating === null ? "–" : String(rating), rating === null ? null : icon));
  }

  async function load() {
    try {
      const [rows, people, locations] = await Promise.all([
        listWorkshops(),
        // Archived ones too: a search covers your whole history. People
        // are opened, for their aliases (searched too).
        listItems("people", "all"),
        listItems("locations", "all"),
      ]);
      workshops = /** @type {Workshop[]} */ (rows);
      const me = people.find((p) => p.is_self);
      selfId = me?.id ?? null;
      selfIsEducator = !!me?.is_educator;
      /** @param {Record<string, any>} item */
      const option = (item) => ({ id: item.id, name: item.name, archived: !!item.archived_at });
      const options = people.map((p) => ({ ...option(p), aliases: readAliases(p.aliases) }));
      peopleFilter.setOptions(options);
      // Everyone marked Educator, and anyone who's taught one of these.
      const taught = new Set(workshops.flatMap((w) => w.educators.map((e) => e.person_id)));
      educatorsFilter.setOptions(options.filter((o, i) => people[i].is_educator || taught.has(o.id)));
      locationsFilter.setOptions(locations.map(option));
      loadProblem = null;
    } catch (err) {
      loadProblem = "Couldn't load your workshops: " + errorMessage(err);
    }
    render();
  }

  showTags();
  load();
}
