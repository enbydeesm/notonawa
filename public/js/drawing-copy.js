// "Copy to…": choosing the tie, plan or workshop to copy a drawing (or a
// pose: poses-ui.js uses it too) to. They're loaded by item-targets.js:
// ties searched as on the Ties page, newest first; plans (not archived)
// and workshops all at once, searched by title here.

import { errorMessage } from "./api.js";
import { h, showMessage, privateField } from "./dom.js";
import { loadTies, loadPlans, loadWorkshops } from "./item-targets.js";
import { itemOf, titleMatches, SHOWN } from "./add-to-choices.js";

/** @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item */
/** @typedef {"tie" | "plan" | "workshop"} Kind */
/** @typedef {{ item: Item, title: string, meta: string }} Target */

const KINDS = /** @type {const} */ ([["tie", "Tie"], ["plan", "Plan"], ["workshop", "Workshop"]]);

/**
 * @param {{ exclude: Item | null, noun?: string }} options exclude: the item
 *   the drawing is on (not offered); noun: what's copied ("drawing", "pose")
 * @returns {Promise<Target | null>} null if cancelled
 */
export function chooseCopyTarget({ exclude, noun = "drawing" }) {
  return new Promise((resolve) => {
    /** @type {Kind} */
    let kind = "tie";
    /** @type {Target | null} */
    let result = null;
    /** Plans' and workshops', once loaded. @type {Partial<Record<Kind, Target[]>>} */
    const loaded = {};
    /** Only the latest search's results are shown. */
    let searchCount = 0;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let typing;

    const message = h("p", { className: "message", id: "drawing-copy-message", "aria-live": "polite" });
    const list = h("div", { className: "copy-targets", id: "drawing-copy-list" });
    const search = privateField(h("input", {
      id: "drawing-copy-search", type: "search", placeholder: "Search by title",
      oninput: () => { clearTimeout(typing); typing = setTimeout(show, 250); },
    }));
    const kindButtons = KINDS.map(([k, label]) => h("button", {
      type: "button", className: "tool", id: `drawing-copy-${k}`, "aria-pressed": String(k === kind),
      onclick: () => { kind = k; for (const [i, b] of kindButtons.entries()) b.setAttribute("aria-pressed", String(KINDS[i][0] === k)); show(); },
    }, label));

    const dialog = h("dialog", { className: "form-dialog", "aria-labelledby": "drawing-copy-heading" },
      h("h2", { id: "drawing-copy-heading" }, "Copy to…"),
      h("p", { className: "hint" }, `The copy can be edited without changing this ${noun}.`),
      h("div", { className: "tool-group", role: "group", "aria-label": "Copy to a" }, kindButtons),
      h("label", { htmlFor: "drawing-copy-search" }, "Search"),
      search,
      message,
      list,
      h("button", { type: "button", className: "dialog-cancel", onclick: () => dialog.close() }, "Cancel"));
    dialog.addEventListener("close", () => {
      clearTimeout(typing);
      dialog.remove();
      resolve(result);
    });

    async function show() {
      const mine = ++searchCount;
      const q = search.value.trim();
      showMessage(message, "Loading…");
      try {
        const targets = (await find(kind, q)).filter((t) => !sameItem(t.item, exclude));
        if (mine !== searchCount) return;
        showMessage(message, targets.length ? "" : q ? "Nothing matches." : `No ${kind}s yet.`);
        list.replaceChildren(...targets.slice(0, SHOWN).map((t) => h("button", {
          type: "button", className: "copy-target", onclick: () => { result = t; dialog.close(); },
        }, h("span", { className: "item-title" }, t.title), t.meta ? h("span", { className: "item-meta" }, t.meta) : null)));
      } catch (err) {
        if (mine === searchCount) showMessage(message, "Couldn't load them: " + errorMessage(err), true);
      }
    }

    /**
     * @param {Kind} k
     * @param {string} q
     * @returns {Promise<Target[]>}
     */
    async function find(k, q) {
      /** @param {import("./add-to-choices.js").Target} t @returns {Target} */
      const asTarget = (t) => ({ item: itemOf(t), title: t.title, meta: t.meta });
      if (k === "tie") return (await loadTies(q)).targets.map(asTarget);
      loaded[k] ??= (await (k === "plan" ? loadPlans() : loadWorkshops())).map(asTarget);
      return /** @type {Target[]} */ (loaded[k]).filter((t) => titleMatches(t.title, q));
    }

    document.body.append(dialog);
    dialog.showModal();
    show();
  });
}

/**
 * @param {Item} a
 * @param {Item | null} b
 */
function sameItem(a, b) {
  return !!b && Object.entries(a).every(([key, value]) => /** @type {Record<string, string>} */ (b)[key] === value);
}
