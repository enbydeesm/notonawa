// A tie's or plan's Workshop row (migration 0030): the workshop it was tied
// at or learned at, if any. "Workshop" with a small + after it; + shows a
// drop-down of my workshops (loaded then, newest first); once one's chosen
// it shows as its name with the cap icon, tapping it opens the workshop, and
// × unlinks it. The hidden input, workshop_id, is what the form sends. The
// same link is made from the workshop's "Ties and plans" (workshop-form.js).

import { api, errorMessage } from "./api.js";
import { h, privateField, removeX } from "./dom.js";
import { tabIcon } from "./nav.js";
import { formatDate } from "./format.js";

/**
 * @param {{ idPrefix: string, onError: (text: string) => void }} options
 *   idPrefix: "tie" or "plan", for the ids inside the form's dialog
 * @returns {{ element: HTMLElement, set: (id: string | null, title?: string) => void }}
 */
export function workshopLink({ idPrefix, onError }) {
  const input = privateField(h("input", { type: "hidden", name: "workshop_id", id: `${idPrefix}-workshop_id`, value: "" }));
  const addButton = h("button", {
    type: "button", className: "label-add", id: `${idPrefix}-workshop-show`, "aria-label": "Link a workshop", title: "Link a workshop",
    onclick: showPicker,
  }, "+");
  const select = h("select", {
    id: `${idPrefix}-workshop-pick`, "aria-labelledby": `${idPrefix}-workshop-label`,
    onchange: () => {
      const option = select.selectedOptions[0];
      if (option?.value) set(option.value, option.dataset.title ?? option.textContent ?? "");
    },
  });
  const pickRow = h("div", { className: "picker-row", hidden: true }, select);
  const name = h("button", { type: "button", className: "link workshop-link-name", id: `${idPrefix}-workshop-name`, onclick: openWorkshop });
  const chosenRow = h("div", { className: "picker-row removable workshop-chosen", hidden: true },
    h("span", { className: "workshop-link-icon", "aria-hidden": "true" }, tabIcon("/education")),
    name,
    removeX("Unlink workshop", () => set(null)));
  const element = h("div", { className: "workshop-link" },
    h("div", { className: "label-row" }, h("label", { id: `${idPrefix}-workshop-label` }, "Workshop"), addButton),
    input, pickRow, chosenRow);

  /**
   * Shows a workshop as linked, or (null) none.
   * @param {string | null} id
   * @param {string} [title]
   */
  function set(id, title = "") {
    const changed = input.value !== (id ?? "");
    input.value = id ?? "";
    name.textContent = title || "Untitled workshop";
    chosenRow.hidden = !id;
    pickRow.hidden = true;
    addButton.hidden = !!id;
    // Code setting a value fires no event: this tells the form it changed.
    if (changed) input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function showPicker() {
    addButton.hidden = true;
    pickRow.hidden = false;
    select.replaceChildren(h("option", { value: "" }, "Loading…"));
    try {
      const workshops = await api("/api/workshops");
      select.replaceChildren(
        h("option", { value: "" }, workshops.length ? "Choose a workshop" : "No workshops yet"),
        ...workshops.map((/** @type {any} */ w) => h("option", { value: w.id, "data-title": w.title }, `${w.title}, ${formatDate(w.start_date)}`)));
      select.focus();
    } catch (err) {
      onError("Couldn't load your workshops: " + errorMessage(err));
      set(null);
    }
  }

  async function openWorkshop() {
    try {
      const { editWorkshop } = await import("./workshop-form.js");
      await editWorkshop(input.value);
    } catch (err) {
      onError("Couldn't open the workshop: " + errorMessage(err));
    }
  }

  return { element, set };
}
