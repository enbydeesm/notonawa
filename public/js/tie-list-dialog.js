// The Analytics view's list of the ties behind a bar, slice or calendar
// day: their cards in a dialog, newest first, 100 at a time. Tapping a
// title opens the tie in the tie form; saving or deleting it reloads the
// list and tells the view, so its numbers catch up.

import { errorMessage } from "./api.js";
import { h } from "./dom.js";
import { tieCard, fitPeople, editTie } from "./tie-card.js";
import { findTies } from "./store/index.js";

const PAGE_SIZE = 100;

/**
 * @param {{ heading: string, tieIds: string[], onChange: () => void }} config
 *   heading: e.g. "March 2026 · 8 ties"; tieIds: the ties to list (my own:
 *   the server only finds mine); onChange: runs after a tie is saved or
 *   deleted from the list
 */
export function openTieList({ heading, tieIds, onChange }) {
  let page = 0;
  const list = h("div", { className: "tie-list-cards", id: "tl-list" });
  const more = h("button", { type: "button", id: "tl-more", hidden: true, onclick: () => loadPage(page + 1) }, "Show more");
  const message = h("p", { className: "message error", role: "alert" });

  const dialog = h("dialog", { className: "form-dialog tie-list-dialog", "aria-labelledby": "tl-heading" },
    h("div", { className: "tie-list-header" },
      h("h2", { id: "tl-heading" }, heading),
      h("button", { type: "button", className: "icon-button", id: "tl-close", "aria-label": "Close", title: "Close", onclick: () => dialog.close() }, "×")),
    list, more, message);
  // A tap on the dimmed page around it closes it too.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => dialog.remove());

  /** @param {number} n 1 for the first page */
  async function loadPage(n) {
    message.textContent = "";
    more.disabled = true;
    try {
      const res = await findTies({ ids: tieIds, page: n, page_size: PAGE_SIZE });
      const ties = res.ties;
      if (n === 1) list.replaceChildren();
      list.append(...ties.map((/** @type {Record<string, any>} */ tie) => tieCard(tie, openTie)));
      fitPeople(list);
      page = n;
      more.hidden = n * PAGE_SIZE >= res.total;
      if (res.total === 0) list.append(h("p", { className: "empty" }, "These ties have been deleted."));
    } catch (err) {
      message.textContent = "Couldn't load the ties: " + errorMessage(err);
    } finally {
      more.disabled = false;
    }
  }

  /** @param {string} id */
  async function openTie(id) {
    let changed;
    try {
      changed = await editTie(id);
    } catch (err) {
      message.textContent = "Couldn't open the tie: " + errorMessage(err);
      return;
    }
    if (!changed) return;
    // A deleted tie drops out of the list; an edited one may no longer
    // belong to this bar, but stays listed until the dialog is reopened.
    await loadPage(1);
    onChange();
  }

  document.body.append(dialog);
  dialog.showModal();
  loadPage(1);
  return dialog;
}

/**
 * Opens one tie straight in the tie form (a calendar day with just one tie).
 * @param {string} id
 * @param {() => void} onChange runs if it was saved or deleted
 * @param {(text: string) => void} onError
 */
export async function openOneTie(id, onChange, onError) {
  try {
    if (await editTie(id)) onChange();
  } catch (err) {
    onError("Couldn't open the tie: " + errorMessage(err));
  }
}
