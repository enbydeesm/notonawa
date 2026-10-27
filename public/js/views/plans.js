// Plans view: "Add a Plan" (the + opens the form in a dialog, which tapping
// a plan's card opens too, with its Delete, Archive and Share icons), a
// search over the plans, and the list, as cards like the ties'. A saved
// plan's form lists the ties it's on, folded away; tapping one opens it in
// the tie form.

import { h, $, showMessage } from "../dom.js";
import { choose } from "../dialog.js";
import { setupResourcePage } from "../resource-page.js";
import { ratingField, ratingHanks } from "../rope-rating.js";
import { pickTags } from "../tag-picker.js";
import { TIE_TYPES } from "../ties-view.js";
import { capitalise } from "../format.js";
import { WEB_LINK_PATTERN, webLinkOrNull } from "../links.js";
import { albumLink, editTie } from "../tie-card.js";
import { openShareItem } from "../share-item-dialog.js";
import { iconButton } from "../dialog-icons.js";
import { errorMessage } from "../api.js";
import { multiSelect } from "../multi-select.js";
import { MAX_KEYWORD_LENGTH } from "../search-match.js";
import {
  PLAN_TYPE_NAMES, EMPTY_SEARCH, tieSummary, tieCountText, filterPlans, hasPlanFilters,
} from "../plans-view.js";

/** @typedef {import("../plans-view.js").PlanSearch} PlanSearch */
/** @typedef {import("../plans-view.js").LinkedTie} LinkedTie */

const KEYWORD_DELAY_MS = 300;

/**
 * @param {HTMLElement} _root
 * @param {{ signal: AbortSignal }} options
 */
export function mount(_root, { signal }) {
  /** @type {HTMLSelectElement} */
  const variationSelect = $("#plan-variation_of");
  /** @type {HTMLDialogElement} */
  const dialog = $("#plan-dialog");
  const formMessage = $("#form > .message");
  /** @type {Record<string, any>[]} */
  let activePlans = [];
  // Difficulty as rope hanks; its hidden input is the form's est_difficulty.
  const difficulty = ratingField({ name: "est_difficulty", labelledBy: "plan-est_difficulty-label" });
  $("#plan-est_difficulty-picker").replaceChildren(difficulty.element);
  $("#plan-tie_type").append(...TIE_TYPES.map((t) => h("option", { value: t }, capitalise(t))));
  $("#plan-album_url").setAttribute("pattern", WEB_LINK_PATTERN);

  // The plan's tags, by name: new ones are created when it's saved.
  /** @type {string[]} */
  let tags = [];
  const tagList = $("#plan-tags");
  function showTags() {
    tagList.replaceChildren(...tags.map((name) => h("span", { className: "tag outline" }, name)));
  }
  $("#plan-add-tags").addEventListener("click", async () => {
    const picked = await pickTags(tags, { noun: "plan" });
    if (picked === null) return;
    tags = picked;
    showTags();
  }, { signal });

  /**
   * The ties a saved plan is on, newest first, under "Linked ties (n)",
   * folded until it's tapped: each title opens the tie, with its rating at
   * the end of the row. Hidden for a new plan, or one on no ties.
   * @param {LinkedTie[]} ties
   */
  function showLinkedTies(ties) {
    $("#plan-linked").hidden = ties.length === 0;
    $("#plan-linked-count").textContent = `(${ties.length})`;
    $("#plan-linked-ties").replaceChildren(...ties.map((tie) => h("li", { className: "linked-tie" },
      h("button", { type: "button", className: "link linked-tie-title", onclick: () => openTie(tie.id) },
        tie.title || "Untitled tie"),
      tie.success_rating != null ? ratingHanks(tie.success_rating, `Rating ${tie.success_rating}/5`) : null)));
  }

  /**
   * Opens a linked tie over the plan's form. If it's saved or deleted, the
   * list reloads and the form's linked ties with it (the plan may have
   * been taken off it); what's typed in the form stays.
   * @param {string} id
   */
  async function openTie(id) {
    try {
      if (!(await editTie(id))) return;
    } catch (err) {
      showMessage(formMessage, "Couldn't open the tie: " + errorMessage(err), true);
      return;
    }
    const planId = page.editing();
    await page.reload();
    const plan = page.items().find((p) => p.id === planId);
    if (plan && dialog.open) showLinkedTies(plan.linked_ties ?? []);
  }

  /**
   * The "Variation of" picker lists active plans, except the one being edited.
   * @param {string} [excludeId]
   * @param {string | null} [keepId] a linked plan to keep even if it's archived
   */
  function fillVariationOptions(excludeId, keepId) {
    variationSelect.replaceChildren(h("option", { value: "" }, "N/A"));
    for (const plan of activePlans) {
      if (plan.id !== excludeId) variationSelect.append(h("option", { value: plan.id }, plan.title));
    }
    // Editing a variation of an archived plan: keep that link rather than losing it on save.
    if (keepId && !activePlans.some((p) => p.id === keepId)) {
      variationSelect.append(h("option", { value: keepId }, "(archived plan)"));
    }
  }

  // The search: kept here only, so it starts empty each time.
  /** @type {PlanSearch} */
  let search = { ...EMPTY_SEARCH };

  const page = setupResourcePage({
    resource: "plans",
    signal,
    form: $("#form"),
    list: $("#list"),
    archivedToggle: $("#show-archived"),
    dialog,
    actionsInDialog: true,
    // A copy of the plan as last saved, not of what's typed.
    extraActions: (plan) => [iconButton("share", {
      id: "plan-share", label: "Share plan",
      onclick: async () => {
        showMessage(formMessage, "");
        try {
          await openShareItem("plan", plan);
        } catch (err) {
          showMessage(formMessage, "Couldn't share it: " + errorMessage(err), true);
        }
      },
    })],
    changeState: () => tags,
    itemClass: "tie-card plan-card",
    filter: (plans) => filterPlans(plans, search),

    // Reloaded with a plan open (after editing one of its linked ties):
    // its choice is kept, not reset to N/A.
    onLoad: (plans, archived) => {
      if (!archived) activePlans = plans;
      const editing = dialog.open ? page.editing() : null;
      const chosen = variationSelect.value;
      fillVariationOptions(editing ?? undefined, editing ? chosen || null : null);
      variationSelect.value = chosen;
    },
    beforeFill: (plan) => fillVariationOptions(plan.id, plan.variation_of),
    // The form's reset empties the hidden input but not the hanks, nor the
    // tags or linked ties.
    onEdit: (plan) => {
      difficulty.set(plan?.est_difficulty ?? null);
      tags = [...(plan?.tags ?? [])];
      showTags();
      showLinkedTies(plan?.linked_ties ?? []);
      /** @type {HTMLDetailsElement} */ ($("#plan-linked")).open = false;
    },
    // The album link is sealed before it's sent, so the server can't check it.
    prepare: (data) => ({ ...data, tags, album_url: webLinkOrNull(data.album_url) }),

    // A card like a tie's: the title (which opens the dialog, as tapping
    // the card does) and the plan type; the tie type and what it's a
    // variation of, and the difficulty in hanks; how many photos and how
    // many ties it's on; the album; the tags. Its description and notes
    // are in the dialog only.
    renderItem: (plan, plans, edit) => {
      const parent = plan.variation_of && plans.find((p) => p.id === plan.variation_of);
      const kind = [plan.tie_type ? capitalise(plan.tie_type) : null,
        plan.variation_of ? `variation of ${parent ? parent.title : "another plan"}` : null].filter(Boolean).join(" · ");
      const { count } = tieSummary(plan.linked_ties ?? []);
      return [
        h("button", { type: "button", className: "tie-title", onclick: edit }, plan.title),
        h("span", { className: "tie-date plan-type" }, PLAN_TYPE_NAMES[plan.plan_type] || plan.plan_type),
        h("div", { className: "tie-place" }, kind),
        plan.est_difficulty != null
          ? h("div", { className: "tie-rating" }, ratingHanks(plan.est_difficulty, `Difficulty ${plan.est_difficulty}/5`))
          : null,
        h("div", { className: "plan-photos" }, plan.photo_count ? (plan.photo_count === 1 ? "1 photo" : `${plan.photo_count} photos`) : null),
        h("div", { className: "plan-ties" }, tieCountText(count)),
        albumLink(plan.album_url, "tie-album"),
        plan.tags?.length
          ? h("div", { className: "tag-row tie-tags" }, plan.tags.map((/** @type {string} */ name) => h("span", { className: "tag outline" }, name)))
          : null,
      ];
    },

    confirmDelete: async (plan) => {
      const choice = await choose({
        title: `Delete "${plan.title}"?`,
        message: "This can't be undone. Should ties that used this plan drop it too, " +
          `or keep a "(plan deleted)" note?`,
        choices: [
          { label: "Remove from linked ties too", value: "remove", style: "danger" },
          { label: "Just delete the plan", value: "keep", style: "danger" },
        ],
      });
      return choice ? { query: `?linked_ties=${choice}` } : null;
    },
  });

  $("#add-plan").addEventListener("click", () => page.add(), { signal });

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

  /**
   * Changes the search and redraws the list.
   * @param {Partial<PlanSearch>} changes
   */
  function update(changes) {
    search = { ...search, ...changes };
    clearButton.hidden = !hasPlanFilters(search);
    showSearchTags();
    page.redraw();
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
