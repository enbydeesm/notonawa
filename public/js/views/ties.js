// Ties view: search and page through logged ties. New ties are logged from
// the + button (tie-form.js); tapping a tie's title opens it in the same form
// to edit or delete.

import { api, errorMessage } from "../api.js";
import { h, $ } from "../dom.js";
import { TIE_SAVED } from "../nav.js";
import { openTieForm } from "../tie-form.js";
import { formatDate } from "../format.js";
import { multiSelect } from "../multi-select.js";
import { pickTags } from "../tag-picker.js";
import { findTag } from "../tags.js";
import { ratingHanks } from "../rope-rating.js";
import { placeLine, participantLabel, showingText, peopleThatFit } from "../ties-view.js";
import { readSearch, pageQuery, searchBody, hasKeywordInUrl, hasFilters, pageList } from "../tie-search.js";
import { open, searchTies } from "../vault.js";
import { MAX_KEYWORD_LENGTH } from "../search-match.js";

/** @typedef {import("../tie-search.js").SearchState} SearchState */

const KEYWORD_DELAY_MS = 300;

/**
 * @param {HTMLElement} _root the view's element
 * @param {{ signal: AbortSignal }} context signal: fires when the view is left
 */
export function mount(_root, { signal }) {
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
  /** @type {HTMLSelectElement} */
  const pageSizeSelect = $("#page-size");
  /** @type {HTMLButtonElement} */
  const sortButton = $("#sort");
  const tagFilter = $("#tag-filter");
  /** @type {HTMLButtonElement} */
  const tagsAny = $("#tags-any");
  /** @type {HTMLButtonElement} */
  const tagsAll = $("#tags-all");

  /** @type {import("../tags.js").Tag[]} my tags, to show the chosen ones' names */
  let allTags = [];

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
    showTags();
    showListControls();
    clearButton.hidden = !hasFilters(state);
  }

  /** The page size and the sort button (pressed = oldest first). */
  function showListControls() {
    pageSizeSelect.value = String(state.page_size);
    const oldest = state.sort === "oldest";
    sortButton.setAttribute("aria-pressed", String(oldest));
    sortButton.title = oldest ? "Oldest first" : "Newest first";
  }

  /** The chosen tags (each with × to remove it) and the OR / AND toggle. */
  function showTags() {
    tagsAny.setAttribute("aria-pressed", String(state.tag_match === "any"));
    tagsAll.setAttribute("aria-pressed", String(state.tag_match === "all"));
    const chosen = allTags.filter((tag) => tag.id && state.tag_ids.includes(tag.id));
    tagFilter.replaceChildren(...chosen.map((tag) =>
      h("span", { className: "tag outline" }, tag.name,
        h("button", {
          type: "button", className: "tag-x", "aria-label": `Remove ${tag.name}`,
          onclick: () => { update({ tag_ids: state.tag_ids.filter((id) => id !== tag.id) }); showTags(); },
        }, "×"))));
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
  signal.addEventListener("abort", () => clearTimeout(keywordTimer));
  $("#tags-choose").addEventListener("click", async () => {
    const names = allTags.filter((tag) => tag.id && state.tag_ids.includes(tag.id)).map((tag) => tag.name);
    const picked = await pickTags(names, { forSearch: true });
    if (picked === null) return; // closed with Esc: keep the search as it was
    // A tag added on a tie since the page loaded isn't in allTags yet.
    if (picked.some((name) => !findTag(allTags, name))) await loadTags();
    const ids = picked.map((name) => findTag(allTags, name)?.id).filter((id) => typeof id === "string");
    update({ tag_ids: ids });
    showTags();
  });
  pageSizeSelect.addEventListener("change", () => update({ page_size: Number(pageSizeSelect.value) }));
  sortButton.addEventListener("click", () => {
    update({ sort: state.sort === "oldest" ? "newest" : "oldest" });
    showListControls();
  });
  tagsAny.addEventListener("click", () => { update({ tag_match: "any" }); showTags(); });
  tagsAll.addEventListener("click", () => { update({ tag_match: "all" }); showTags(); });
  fromInput.addEventListener("change", () => update({ from: fromInput.value }));
  toInput.addEventListener("change", () => update({ to: toInput.value }));
  clearButton.addEventListener("click", () => {
    clearTimeout(keywordTimer);
    update({ person_ids: [], location_ids: [], tag_ids: [], tag_match: "any", from: "", to: "", q: "" });
    showState();
  });
  // Back and Forward restore the filters and page; the keyword isn't in history,
  // so the current one stays. (Back to another view is app.js's: it ends this
  // view first, so this listener is gone by then.)
  window.addEventListener("popstate", () => {
    state = { ...readSearch(location.search), q: state.q };
    showState();
    loadTies();
  }, { signal });
  document.addEventListener(TIE_SAVED, () => { loadTies(); loadTags(); }, { signal });

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

  async function loadTags() {
    try {
      allTags = await api("/api/tags");
    } catch (err) {
      count.textContent = "Couldn't load tags: " + errorMessage(err);
      return;
    }
    // A tag deleted since this address was saved would match nothing; drop it
    // rather than leave a filter you can't see.
    const known = state.tag_ids.filter((id) => allTags.some((tag) => tag.id === id));
    if (known.length !== state.tag_ids.length) update({ tag_ids: known });
    showTags();
  }

  /** @param {import("../ties-view.js").Label} label */
  function renderLabel(label) {
    if (label.rating !== undefined) return ratingHanks(label.rating, label.text);
    return label.deleted ? h("span", { className: "deleted" }, label.text) : label.text;
  }

  /**
   * A tie as a card: title (tap to edit) and date; type and location, and the
   * rating; who took part, on one line; and its tags.
   * @param {Record<string, any>} tie
   */
  function renderTie(tie) {
    const place = placeLine(tie);
    const people = tie.participants.map((/** @type {any} */ p, /** @type {number} */ i) => {
      const { name, role } = participantLabel(p);
      return h("span", { className: "tie-person" }, i > 0 ? ", " : "", renderLabel(name), ` (${role})`);
    });

    return h("article", { className: "tie-card" },
      h("button", { type: "button", className: "tie-title", onclick: () => editTie(tie.id) }, tie.title || "Untitled tie"),
      h("span", { className: "tie-date" }, formatDate(tie.tie_date)),
      h("div", { className: "tie-place" }, place.flatMap((part, i) => (i === 0 ? [renderLabel(part)] : [" ", renderLabel(part)]))),
      tie.success_rating != null
        ? h("div", { className: "tie-rating" }, ratingHanks(tie.success_rating, `Rating ${tie.success_rating}/5`))
        : null,
      people.length
        ? h("div", { className: "tie-with" }, h("span", { className: "tie-with-label" }, "With: "), people, h("span", { className: "tie-more", hidden: true }))
        : null,
      tie.tags.length
        ? h("div", { className: "tag-row tie-tags" }, tie.tags.map((/** @type {string} */ name) => h("span", { className: "tag outline" }, name)))
        : null
    );
  }

  /**
   * Shows as many people as fit on each tie's "With:" line, and "+2" for the
   * rest (its tooltip names them). Run after the list is drawn and when its
   * width changes.
   */
  function fitPeople() {
    for (const line of list.querySelectorAll(".tie-with")) {
      const people = /** @type {HTMLElement[]} */ ([...line.querySelectorAll(".tie-person")]);
      const more = /** @type {HTMLElement} */ ($(".tie-more", line));
      const label = /** @type {HTMLElement} */ ($(".tie-with-label", line));
      for (const person of people) person.hidden = false;
      more.hidden = false;
      const moreWidth = (/** @type {number} */ n) => { more.textContent = ` +${n}`; return more.offsetWidth; };
      const shown = peopleThatFit(people.map((p) => p.offsetWidth), line.clientWidth - label.offsetWidth, moreWidth);
      people.forEach((person, i) => { person.hidden = i >= shown; });
      const hiddenPeople = people.slice(shown);
      more.hidden = hiddenPeople.length === 0;
      moreWidth(hiddenPeople.length);
      more.title = hiddenPeople.map((p) => (p.textContent ?? "").replace(/^, /, "")).join(", ");
      more.setAttribute("aria-label", `and ${hiddenPeople.length} more: ${more.title}`);
    }
  }

  // Refit when the list's width changes (rotating a phone, resizing a window).
  let fittedWidth = 0;
  const resized = new ResizeObserver(() => {
    if (list.clientWidth === fittedWidth) return;
    fittedWidth = list.clientWidth;
    fitPeople();
  });
  resized.observe(list);
  signal.addEventListener("abort", () => resized.disconnect());

  /**
   * Opens a tie in the tie form to edit or delete; reloads the list if it changed.
   * @param {string} id
   */
  async function editTie(id) {
    let tie;
    try {
      [tie] = await open("tie", [await api(`/api/ties/${encodeURIComponent(id)}`)]);
    } catch (err) {
      count.textContent = "Couldn't open the tie: " + errorMessage(err);
      return;
    }
    if (await openTieForm(tie)) {
      loadTies();
      loadTags();
    }
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
      // The keyword is searched for here, on the device; only the ids of the
      // ties it matched go to the server, which filters, sorts and pages.
      const keywordText = state.q.trim();
      if (keywordText.length > MAX_KEYWORD_LENGTH) throw new Error(`Search for ${MAX_KEYWORD_LENGTH} characters or fewer.`);
      const matchIds = keywordText ? await searchTies(keywordText) : null;
      if (request !== latestRequest) return;
      const { ties, total, all_total, page, page_size } = await api("/api/ties/search", { method: "POST", body: searchBody(state, matchIds) });
      if (request !== latestRequest) return;
      const totalPages = Math.ceil(total / page_size);
      count.textContent = showingText(total, all_total);
      list.replaceChildren(...ties.map(renderTie));
      fitPeople();
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
  loadTags();
  loadTies();
}
