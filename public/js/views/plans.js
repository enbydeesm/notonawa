// Plans view.

import { h, $ } from "../dom.js";
import { choose } from "../dialog.js";
import { setupResourcePage } from "../resource-page.js";

/** @type {Record<string, string>} */
const STAGES = { idea: "Idea", developing: "Developing", ready: "Ready", retired: "Retired" };

export function mount() {
  /** @type {HTMLSelectElement} */
  const variationSelect = $("#variation_of");
  /** @type {Record<string, any>[]} */
  let activePlans = [];

  /**
   * The "Variation of" picker lists active plans, except the one being edited.
   * @param {string} [excludeId]
   * @param {string | null} [keepId] a linked plan to keep even if it's archived
   */
  function fillVariationOptions(excludeId, keepId) {
    variationSelect.replaceChildren(h("option", { value: "" }, "Not a variation"));
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
    form: $("#form"),
    list: $("#list"),
    archivedToggle: $("#show-archived"),

    onLoad: (plans, archived) => {
      if (!archived) activePlans = plans;
      fillVariationOptions();
    },
    beforeFill: (plan) => fillVariationOptions(plan.id, plan.variation_of),

    renderItem: (plan, plans) => {
      const parent = plan.variation_of && plans.find((p) => p.id === plan.variation_of);
      const meta = [STAGES[plan.stage] || plan.stage];
      if (plan.est_difficulty != null) meta.push(`difficulty ${plan.est_difficulty}/5`);
      meta.push(`v${plan.version}`);
      if (plan.variation_of) meta.push(`variation of ${parent ? parent.title : "another plan"}`);
      return [
        h("div", { className: "item-title" }, plan.title),
        h("div", { className: "item-meta" }, meta.join(" · ")),
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
