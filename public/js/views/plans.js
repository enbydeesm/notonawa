// Plans view: "Add a Plan" (the + opens the plan form, plan-form.js, which
// tapping a plan's card opens too), a search over the plans, and the list,
// as cards like the ties', with Show archived. The form is a dialog of its
// own, so it opens from elsewhere too (the poser on its own).

import { h, $, opensOnTap } from "../dom.js";
import { errorMessage } from "../api.js";
import { openPlanForm } from "../plan-form.js";
import { PLAN_SAVED } from "../nav.js";
import { ratingHanks } from "../rope-rating.js";
import { pickTags } from "../tag-picker.js";
import { TIE_TYPES, showingText } from "../ties-view.js";
import { capitalise, attachedText } from "../format.js";
import { capMark } from "../charts.js";
import { visualsRow } from "../tie-card.js";
import { multiSelect } from "../multi-select.js";
import { MAX_KEYWORD_LENGTH } from "../search-match.js";
import {
  PLAN_TYPE_NAMES, planKindText, EMPTY_SEARCH, filterPlans, hasPlanFilters,
} from "../plans-view.js";
import { listItems } from "../store/index.js";

/** @typedef {import("../plans-view.js").PlanSearch} PlanSearch */

const KEYWORD_DELAY_MS = 300;

/**
 * @param {HTMLElement} _root
 * @param {{ signal: AbortSignal }} options
 */
export function mount(_root, { signal }) {
  /** @type {HTMLInputElement} */
  const archivedToggle = $("#show-archived");
  const list = $("#list");
  const count = $("#plan-count");
  /** The plans loaded: active, or archived with Show archived. @type {Record<string, any>[]} */
  let plans = [];

  // The search: kept here only, so it starts empty each time.
  /** @type {PlanSearch} */
  let search = { ...EMPTY_SEARCH };

  async function load() {
    const archived = archivedToggle.checked;
    try {
      const loaded = await listItems("plans", archived);
      if (signal.aborted) return;
      plans = loaded;
      draw();
    } catch (err) {
      list.replaceChildren(h("p", { className: "empty" }, "Couldn't load: " + errorMessage(err)));
    }
  }

  /** Draws the list: all of it, or what the search finds. Tapping a card anywhere opens it. */
  function draw() {
    count.textContent = plans.length ? showingText(filterPlans(plans, search).length, plans.length) : "";
    if (plans.length === 0) {
      list.replaceChildren(h("p", { className: "empty" }, archivedToggle.checked ? "Nothing archived." : "Nothing here yet. Add one above."));
      return;
    }
    const shown = filterPlans(plans, search);
    list.replaceChildren(...(shown.length ? [] : [h("p", { className: "empty" }, "No matches.")]), ...shown.map((plan) => {
      const unreadable = plan.unreadable?.length ? h("div", { className: "item-meta deleted" }, "(can't decrypt the notes)") : null;
      const row = h("div", { className: "tie-card plan-card" }, planCard(plan, () => edit(plan)), unreadable);
      return opensOnTap(row, () => edit(plan));
    }));
  }

  /**
   * Opens a plan (or a new one) in its form; reloads if anything changed.
   * @param {Record<string, any> | null} plan
   */
  async function edit(plan) {
    if (await openPlanForm(plan)) load();
  }

  /**
   * A card like a tie's: the title (which opens the form, as tapping the
   * card does) and the plan type; the tie type and what it's a variation
   * of, and the difficulty in hanks; the workshop it's from; how many
   * visuals and ties, then the album link; the tags. Its description and
   * notes are in the form only.
   * @param {Record<string, any>} plan
   * @param {() => void} open
   */
  function planCard(plan, open) {
    const parent = plan.variation_of && plans.find((p) => p.id === plan.variation_of);
    const kind = planKindText(plan, plan.variation_of ? (parent ? parent.title : "") : null);
    return [
      h("button", { type: "button", className: "tie-title", onclick: open }, plan.title),
      h("div", { className: "tie-place" }, kind),
      plan.est_difficulty != null
        ? h("div", { className: "tie-rating" }, ratingHanks(plan.est_difficulty, `Difficulty ${plan.est_difficulty}/5`))
        : null,
      plan.workshop_id
        ? h("div", { className: "plan-workshop" }, capMark(), plan.workshop_title ?? "")
        : null,
      visualsRow(attachedText({ visuals: plan.visual_count, ties: (plan.linked_ties ?? []).length }), plan.album_url),
      plan.tags?.length
        ? h("div", { className: "tag-row tie-tags" }, plan.tags.map((/** @type {string} */ name) => h("span", { className: "tag outline" }, name)))
        : null,
    ];
  }

  $("#add-plan").addEventListener("click", () => edit(null), { signal });
  archivedToggle.addEventListener("change", load, { signal });
  // A plan changed from elsewhere: a pose added from the poser opened on its own.
  document.addEventListener(PLAN_SAVED, () => load(), { signal });

  // The search's inputs. Types are fixed lists, so their ids are the values.
  /** @type {HTMLInputElement} */
  const keyword = $("#search-q");
  keyword.maxLength = MAX_KEYWORD_LENGTH;
  const clearButton = $("#search-clear");
  const tagFilter = $("#search-tag-filter");
  const tagsAny = $("#search-tags-any");
  const tagsAll = $("#search-tags-all");
  const planTypes = multiSelect({
    labelledBy: "search-plan-types-label", placeholder: "Any type", searchLabel: "Search plan types",
    onChange: (ids) => update({ plan_types: ids }),
  });
  const tieTypes = multiSelect({
    labelledBy: "search-tie-types-label", placeholder: "Any type", searchLabel: "Search tie types",
    onChange: (ids) => update({ tie_types: ids }),
  });
  planTypes.setOptions(Object.entries(PLAN_TYPE_NAMES).map(([id, name]) => ({ id, name, archived: false })));
  tieTypes.setOptions(TIE_TYPES.map((id) => ({ id, name: capitalise(id), archived: false })));
  $("#search-plan-types").append(planTypes.element);
  $("#search-tie-types").append(tieTypes.element);

  load();

  /**
   * Changes the search and redraws the list.
   * @param {Partial<PlanSearch>} changes
   */
  function update(changes) {
    search = { ...search, ...changes };
    clearButton.hidden = !hasPlanFilters(search);
    showSearchTags();
    draw();
  }

  /** The chosen tags (each with × to remove it) and the OR / AND toggle. */
  function showSearchTags() {
    tagsAny.setAttribute("aria-pressed", String(search.tag_match === "any"));
    tagsAll.setAttribute("aria-pressed", String(search.tag_match === "all"));
    tagFilter.replaceChildren(...search.tags.map((name) =>
      h("span", { className: "tag outline" }, name,
        h("button", {
          type: "button", className: "tag-x", "aria-label": `Remove ${name}`,
          onclick: () => update({ tags: search.tags.filter((t) => t !== name) }),
        }, "×"))));
  }

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let keywordTimer;
  keyword.addEventListener("input", () => {
    clearTimeout(keywordTimer);
    keywordTimer = setTimeout(() => update({ q: keyword.value }), KEYWORD_DELAY_MS);
  });
  signal.addEventListener("abort", () => clearTimeout(keywordTimer));
  $("#search-tags-choose").addEventListener("click", async () => {
    const picked = await pickTags(search.tags, { forSearch: true, noun: "plan" });
    if (picked !== null) update({ tags: picked });
  });
  tagsAny.addEventListener("click", () => update({ tag_match: "any" }));
  tagsAll.addEventListener("click", () => update({ tag_match: "all" }));
  clearButton.addEventListener("click", () => {
    clearTimeout(keywordTimer);
    keyword.value = "";
    planTypes.setSelected([]);
    tieTypes.setSelected([]);
    update({ ...EMPTY_SEARCH });
  });
}

