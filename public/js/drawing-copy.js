// "Copy to…": choosing the tie, plan or workshop to copy a drawing to. Ties
// are searched as on the Ties page (a keyword is searched for on the
// device, and only the matching ids are sent), newest first; plans (not
// archived) and workshops are all loaded and searched by title here.

import { api, errorMessage } from "./api.js";
import { h, showMessage, privateField } from "./dom.js";
import { formatDate } from "./format.js";
import { searchTies } from "./vault.js";

/** @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item */
/** @typedef {"tie" | "plan" | "workshop"} Kind */
/** @typedef {{ item: Item, title: string, meta: string }} Target */

const KINDS = /** @type {const} */ ([["tie", "Tie"], ["plan", "Plan"], ["workshop", "Workshop"]]);
const SHOWN = 20;

/**
 * @param {{ exclude: Item | null }} options exclude: the item the drawing is on (not offered)
 * @returns {Promise<Target | null>} null if cancelled
 */
export function chooseCopyTarget({ exclude }) {
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
      h("p", { className: "hint" }, "The copy can be edited without changing this drawing."),
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
      if (k === "tie") {
        const matchIds = q ? await searchTies(q) : null;
        const { ties } = await api("/api/ties/search", {
          method: "POST", body: { match_ids: matchIds, page: 1, page_size: SHOWN, sort: "newest" },
        });
        return ties.map((/** @type {any} */ t) => ({ item: { tie_id: t.id }, title: t.title || "Untitled tie", meta: formatDate(t.tie_date) }));
      }
      loaded[k] ??= k === "plan"
        ? (await api("/api/plans?archived=false")).map((/** @type {any} */ p) => ({ item: { plan_id: p.id }, title: p.title, meta: "" }))
        : (await api("/api/workshops")).map((/** @type {any} */ w) => ({
          item: { workshop_id: w.id }, title: w.title, meta: formatDate(w.start_date),
        }));
      const words = q.toLowerCase();
      return /** @type {Target[]} */ (loaded[k]).filter((t) => t.title.toLowerCase().includes(words));
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
