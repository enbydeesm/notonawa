// Plans view.

import { h, $ } from "../dom.js";
import { choose } from "../dialog.js";
import { setupResourcePage } from "../resource-page.js";
import { ratingField, ratingHanks } from "../rope-rating.js";

/** A plan's type, as the list shows it (src/resources/config.js has the list). @type {Record<string, string>} */
const TYPES = { idea: "Idea", harness: "Harness", sequence: "Sequence" };

/**
 * @param {HTMLElement} _root
 * @param {{ signal: AbortSignal }} options
 */
export function mount(_root, { signal }) {
  /** @type {HTMLSelectElement} */
  const variationSelect = $("#variation_of");
  /** @type {Record<string, any>[]} */
  let activePlans = [];
  // Difficulty as rope hanks; its hidden input is the form's est_difficulty.
  const difficulty = ratingField({ name: "est_difficulty", labelledBy: "est_difficulty-label" });
  $("#est_difficulty-picker").replaceChildren(difficulty.element);

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

  setupResourcePage({
    resource: "plans",
    signal,
    form: $("#form"),
    list: $("#list"),
    archivedToggle: $("#show-archived"),

    onLoad: (plans, archived) => {
      if (!archived) activePlans = plans;
      fillVariationOptions();
    },
    beforeFill: (plan) => fillVariationOptions(plan.id, plan.variation_of),
    // The form's reset empties the hidden input but not the hanks.
    onEdit: (plan) => difficulty.set(plan?.est_difficulty ?? null),

    renderItem: (plan, plans) => {
      const parent = plan.variation_of && plans.find((p) => p.id === plan.variation_of);
      /** @type {(string | HTMLElement)[]} */
      const meta = [TYPES[plan.plan_type] || plan.plan_type];
      if (plan.est_difficulty != null) {
        meta.push(h("span", {}, "difficulty ", ratingHanks(plan.est_difficulty, `${plan.est_difficulty}/5`)));
      }
      meta.push(`v${plan.version}`);
      if (plan.variation_of) meta.push(`variation of ${parent ? parent.title : "another plan"}`);
      if (plan.photo_count) meta.push(plan.photo_count === 1 ? "1 photo" : `${plan.photo_count} photos`);
      return [
        h("div", { className: "item-title" }, plan.title),
        h("div", { className: "item-meta" }, meta.flatMap((part, i) => (i ? [" · ", part] : [part]))),
        plan.description ? h("div", { className: "item-notes" }, plan.description) : null,
        plan.notes ? h("div", { className: "item-notes item-meta" }, plan.notes) : null,
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
}
