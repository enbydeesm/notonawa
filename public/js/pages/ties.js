// Ties page: search and page through logged ties. New ties are logged from
// the + button (tie-form.js).

import { api, errorMessage } from "../api.js";
import { h, $ } from "../dom.js";
import { renderNav, TIE_SAVED } from "../nav.js";
import { multiSelect } from "../multi-select.js";
import { tieMeta, participantLabel, planLabel } from "../ties-view.js";
import { readSearch, pageQuery, searchBody, hasKeywordInUrl, hasFilters, pageList } from "../tie-search.js";

/** @typedef {import("../tie-search.js").SearchState} SearchState */

renderNav("/");

const KEYWORD_DELAY_MS = 300;

const list = $("#tie-list");
const pager = $("#pager");
const count = $("#tie-count");
/** @type {HTMLInputElement} */
const keyword = $("#q");
/** @type {HTMLInputElement} */
const fromInput = $("#from");
/** @type {HTMLInputElement} */
const toInput = $("#to");
/** @type {HTMLButtonElement} */
const clearButton = $("#clear");

let state = readSearch(location.search);
// An old bookmark or history entry may still have a keyword in its address.
// It isn't used; rewrite the address without it so it isn't saved again.
if (hasKeywordInUrl(location.search)) history.replaceState(null, "", pageUrl());

/** The page address for the current search: never includes the keyword. */
function pageUrl() {
  const query = pageQuery(state);
  return query ? `/?${query}` : "/";
}

const peopleFilter = multiSelect({
  labelledBy: "people-label",
  placeholder: "Anyone",
  searchLabel: "Search people",
  onChange: (ids) => update({ person_ids: ids }),
});
const locationsFilter = multiSelect({
  labelledBy: "locations-label",
  placeholder: "Anywhere",
  searchLabel: "Search locations",
  onChange: (ids) => update({ location_ids: ids }),
});
$("#people-filter").append(peopleFilter.element);
$("#locations-filter").append(locationsFilter.element);

/** Puts the current search into the inputs (on load, Back, and Clear). */
function showState() {
  keyword.value = state.q;
  fromInput.value = state.from;
  toInput.value = state.to;
  // Stops a backwards date range being picked.
  fromInput.max = state.to;
  toInput.min = state.from;
  peopleFilter.setSelected(state.person_ids);
  locationsFilter.setSelected(state.location_ids);
  clearButton.hidden = !hasFilters(state);
}

/**
 * Changes the search and reloads the list. Any filter change goes back to
 * page 1. Page changes add a history entry (so Back goes to the last page);
 * typing and picking replace it.
 * @param {Partial<SearchState>} changes
 */
function update(changes) {
  const pageChange = "page" in changes;
  state = { ...state, page: 1, ...changes };
  if (pageChange) history.pushState(null, "", pageUrl());
  else history.replaceState(null, "", pageUrl());
  fromInput.max = state.to;
  toInput.min = state.from;
  clearButton.hidden = !hasFilters(state);
  loadTies();
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let keywordTimer;
keyword.addEventListener("input", () => {
  clearTimeout(keywordTimer);
  keywordTimer = setTimeout(() => update({ q: keyword.value }), KEYWORD_DELAY_MS);
});
fromInput.addEventListener("change", () => update({ from: fromInput.value }));
toInput.addEventListener("change", () => update({ to: toInput.value }));
clearButton.addEventListener("click", () => {
  clearTimeout(keywordTimer);
  update({ person_ids: [], location_ids: [], from: "", to: "", q: "" });
  showState();
});
// Back and Forward restore the filters and page; the keyword isn't in history,
// so the current one stays.
window.addEventListener("popstate", () => {
  state = { ...readSearch(location.search), q: state.q };
  showState();
  loadTies();
});
document.addEventListener(TIE_SAVED, () => loadTies());

// Archived people and locations are included (in muted text): a search
// covers your whole history.
async function loadFilterOptions() {
  try {
    const [people, locations] = await Promise.all([
      api("/api/people?archived=all"), api("/api/locations?archived=all"),
    ]);
    /** @param {Record<string, any>} item */
    const option = (item) => ({ id: item.id, name: item.name, archived: !!item.archived_at });
    peopleFilter.setOptions(people.map(option));
    locationsFilter.setOptions(locations.map(option));
  } catch (err) {
    count.textContent = "Couldn't load people and locations: " + errorMessage(err);
  }
}

/** @param {import("../ties-view.js").Label} label */
function renderLabel(label) {
  return label.deleted ? h("span", { className: "deleted" }, label.text) : label.text;
}

/** @param {any[]} parts */
function joinWithCommas(parts) {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [", ", part]));
}

/** @param {Record<string, any>} tie */
function renderTie(tie) {
  const meta = tieMeta(tie);
  const participants = tie.participants.map((/** @type {any} */ p) => {
    const { name, role } = participantLabel(p);
    return [renderLabel(name), ` (${role})`];
  });
  const plansUsed = tie.plans.map((/** @type {any} */ p) => renderLabel(planLabel(p)));

  return h("div", { className: "item" },
    h("div", { className: "item-title" }, tie.title || "Untitled tie"),
    h("div", { className: "item-meta" },
      meta.flatMap((part, i) => (i === 0 ? [renderLabel(part)] : [" · ", renderLabel(part)]))),
    participants.length ? h("div", { className: "item-meta" }, "With: ", joinWithCommas(participants)) : null,
    plansUsed.length ? h("div", { className: "item-meta" }, "Plans: ", joinWithCommas(plansUsed)) : null,
    tie.notes ? h("div", { className: "item-notes" }, tie.notes) : null
  );
}

/**
 * @param {number} page
 * @param {number} totalPages
 */
function renderPager(page, totalPages) {
  const pages = pageList(page, totalPages);
  if (pages.length === 0) return [];
  /** @param {number} n */
  const go = (n) => () => {
    update({ page: n });
    $("#results").scrollIntoView({ block: "start" });
  };
  return [
    h("button", { type: "button", className: "link", "aria-label": "Previous page", disabled: page <= 1, onclick: go(page - 1) }, "‹ Prev"),
    pages.map((n) =>
      n === null
        ? h("span", { className: "pager-gap" }, "…")
        : h("button", {
          type: "button", className: "link", "aria-label": `Page ${n}`,
          "aria-current": n === page ? "page" : null, onclick: go(n),
        }, String(n))),
    h("button", { type: "button", className: "link", "aria-label": "Next page", disabled: page >= totalPages, onclick: go(page + 1) }, "Next ›"),
  ];
}

// Only the newest request's answer is shown, so a slow earlier search can't
// overwrite a later one.
let latestRequest = 0;

async function loadTies() {
  const request = ++latestRequest;
  try {
    const { ties, total, page, page_size } = await api("/api/ties/search", { method: "POST", body: searchBody(state) });
    if (request !== latestRequest) return;
    const totalPages = Math.ceil(total / page_size);
    count.textContent = total === 1 ? "1 tie" : `${total} ties`;
    list.replaceChildren(...ties.map(renderTie));
    if (ties.length === 0) {
      const text = total > 0 ? "Nothing on this page."
        : hasFilters(state) ? "No ties match this search."
        : "No ties yet. Tap + to log your first one.";
      list.append(h("p", { className: "empty" }, text));
    }
    pager.replaceChildren(...renderPager(page, totalPages).flat());
  } catch (err) {
    if (request !== latestRequest) return;
    count.textContent = "";
    pager.replaceChildren();
    list.replaceChildren(h("p", { className: "empty" }, "Couldn't load ties: " + errorMessage(err)));
  }
}

showState();
loadFilterOptions();
loadTies();
