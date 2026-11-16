// A tie's or plan's Workshop row (migration 0030): the workshop it was tied
// at or learned at. Shown only while it's linked to one: the link is made
// from the workshop's "Ties and plans" (workshop-form.js), not here. It
// shows the workshop's name with the cap icon, tapping it opens the
// workshop, and × unlinks it (hiding the row; saving sends the unlink).
// The hidden input, workshop_id, is what the form sends.

import { errorMessage } from "./api.js";
import { h, privateField, removeX } from "./dom.js";
import { tabIcon } from "./nav.js";

/**
 * @param {{ idPrefix: string, onError: (text: string) => void }} options
 *   idPrefix: "tie" or "plan", for the ids inside the form's dialog
 * @returns {{ element: HTMLElement, set: (id: string | null, title?: string) => void }}
 */
export function workshopLink({ idPrefix, onError }) {
  const input = privateField(h("input", { type: "hidden", name: "workshop_id", id: `${idPrefix}-workshop_id`, value: "" }));
  const name = h("button", { type: "button", className: "link workshop-link-name", id: `${idPrefix}-workshop-name`, onclick: openWorkshop });
  const chosenRow = h("div", { className: "picker-row removable workshop-chosen" },
    h("span", { className: "workshop-link-icon", "aria-hidden": "true" }, tabIcon("/education")),
    name,
    removeX("Unlink workshop", () => set(null)));
  const element = h("div", { className: "workshop-link", id: `${idPrefix}-workshop`, hidden: true },
    h("div", { className: "label-row" }, h("label", { id: `${idPrefix}-workshop-label` }, "Workshop")),
    input, chosenRow);

  /**
   * Shows a workshop as linked, or (null) none, hiding the row.
   * @param {string | null} id
   * @param {string} [title]
   */
  function set(id, title = "") {
    const changed = input.value !== (id ?? "");
    input.value = id ?? "";
    name.textContent = title || "Untitled workshop";
    element.hidden = !id;
    // Code setting a value fires no event: this tells the form it changed.
    if (changed) input.dispatchEvent(new Event("change", { bubbles: true }));
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
