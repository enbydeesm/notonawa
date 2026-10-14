// The "Log a tie" form, in a pop-up dialog opened from the + button.

import { api, errorMessage } from "./api.js";
import { h, $, showMessage, privateField } from "./dom.js";
import { today, capitalise } from "./format.js";
import { pickTags } from "./tag-picker.js";
import { ROLES } from "./ties-view.js";

const RATINGS = [
  ["", "Not rated"], ["1", "1 – Rough"], ["2", "2"], ["3", "3 – OK"], ["4", "4"], ["5", "5 – Great"],
];

/** @type {Promise<boolean> | null} */
let openDialog = null;

/**
 * Opens the form. Resolves true once a tie is saved (the dialog closes
 * itself), or false if it's closed without saving. Opening it again while
 * it's open returns the same promise.
 * @returns {Promise<boolean>}
 */
export function openTieForm() {
  openDialog ??= showTieForm().finally(() => { openDialog = null; });
  return openDialog;
}

/** @returns {Promise<boolean>} */
function showTieForm() {
  return new Promise((resolve) => {
    let saved = false;
    // Active (non-archived) people and plans for the pickers.
    /** @type {Record<string, any>[]} */
    let people = [];
    /** @type {Record<string, any>[]} */
    let plans = [];
    /** @type {string[]} tag names; new ones are created when the tie is saved */
    let tags = [];

    // Ids start with "tie-" because this dialog opens on top of pages whose own
    // forms use ids like #title and #notes.
    const message = h("p", { className: "message", id: "tie-message" });
    const participantRows = h("div", { id: "tie-participants" });
    const planRows = h("div", { id: "tie-plans" });
    const locationSelect = h("select", { id: "tie-location_id", name: "location_id" },
      h("option", { value: "" }, "No location"));
    const addParticipantButton = addButton("tie-add-participant", "Add person", addParticipantRow);
    const addPlanButton = addButton("tie-add-plan", "Add plan", addPlanRow);
    const noPeople = h("p", { className: "hint", hidden: true },
      "Add people on the ", h("a", { href: "/people" }, "People"), " page first.");
    const noPlans = h("p", { className: "hint", hidden: true },
      "Add plans on the ", h("a", { href: "/plans" }, "Plans"), " page first.");
    const tagList = h("div", { className: "tag-row", id: "tie-tags" });
    const saveButton = h("button", { type: "submit", className: "primary", id: "tie-save" }, "Save tie");

    const form = h("form", { id: "tie-form", onsubmit: save },
      h("label", { htmlFor: "tie-title" }, "Title"),
      privateField(h("input", { id: "tie-title", name: "title", placeholder: "e.g. Hip harness to futomomo" })),
      h("div", { className: "row" },
        h("div", {},
          h("label", { htmlFor: "tie-tie_date" }, "Date"),
          privateField(h("input", { id: "tie-tie_date", name: "tie_date", type: "date", value: today() }))),
        h("div", {},
          h("label", { htmlFor: "tie-duration_minutes" }, "Duration (min)"),
          privateField(h("input", { id: "tie-duration_minutes", name: "duration_minutes", type: "number", min: "0", max: "1440", inputMode: "numeric" })))),
      h("label", { htmlFor: "tie-location_id" }, "Location"),
      locationSelect,
      h("div", { className: "label-row" }, h("label", {}, "People"), addParticipantButton),
      participantRows, noPeople,
      h("div", { className: "label-row" }, h("label", {}, "Plans"), addPlanButton),
      planRows, noPlans,
      h("label", { htmlFor: "tie-success_rating" }, "How did it go?"),
      h("select", { id: "tie-success_rating", name: "success_rating" },
        RATINGS.map(([value, text]) => h("option", { value }, text))),
      h("label", { htmlFor: "tie-notes" }, "Notes"),
      privateField(h("textarea", { id: "tie-notes", name: "notes", placeholder: "What happened, what changed, what to try next" })),
      h("div", { className: "label-row" }, h("label", {}, "Tags"), addButton("tie-add-tags", "Edit tags", chooseTags)),
      tagList,
      saveButton,
      h("button", { type: "button", className: "dialog-cancel", onclick: () => dialog.close() }, "Cancel"),
      message
    );

    // Unlike the confirmation dialogs, tapping outside doesn't close this
    // one, so a stray tap can't throw away a half-written tie. Esc still does.
    const dialog = h("dialog", { className: "form-dialog", "aria-labelledby": "tie-form-heading" },
      h("h2", { id: "tie-form-heading" }, "Log a tie"),
      form);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(saved);
    });

    /**
     * The small + after a section's label.
     * @param {string} id
     * @param {string} label what it does, for screen readers and the tooltip
     * @param {() => void} onclick
     */
    function addButton(id, label, onclick) {
      return h("button", { type: "button", className: "label-add", id, "aria-label": label, title: label, onclick }, "+");
    }

    /** @param {HTMLElement} row */
    function removeButton(row) {
      return h("button", { type: "button", "aria-label": "Remove", onclick: () => row.remove() }, "✕");
    }

    function addParticipantRow() {
      const row = h("div", { className: "picker-row" });
      row.append(
        h("select", { className: "person", "aria-label": "Person" },
          h("option", { value: "" }, "Choose person"),
          people.map((p) => h("option", { value: p.id }, p.is_self ? `${p.name} (you)` : p.name))),
        h("select", { className: "role", "aria-label": "Role" },
          h("option", { value: "" }, "Role"),
          ROLES.map((r) => h("option", { value: r }, capitalise(r)))),
        removeButton(row)
      );
      participantRows.append(row);
    }

    function addPlanRow() {
      const row = h("div", { className: "picker-row" });
      row.append(
        h("select", { className: "plan", "aria-label": "Plan" },
          h("option", { value: "" }, "Choose plan"),
          plans.map((p) => h("option", { value: p.id }, p.title))),
        removeButton(row)
      );
      planRows.append(row);
    }

    async function chooseTags() {
      const picked = await pickTags(tags);
      if (picked === null) return; // closed with Esc: keep what was chosen before
      tags = picked;
      tagList.replaceChildren(...tags.map((name) => h("span", { className: "tag outline" }, name)));
    }

    async function loadPickers() {
      try {
        const [loadedPeople, locations, loadedPlans] = await Promise.all([
          api("/api/people?archived=false"), api("/api/locations?archived=false"), api("/api/plans?archived=false"),
        ]);
        people = loadedPeople;
        plans = loadedPlans;
        locationSelect.append(...locations.map((/** @type {any} */ l) => h("option", { value: l.id }, l.name)));
        addParticipantButton.hidden = people.length === 0;
        noPeople.hidden = people.length > 0;
        addPlanButton.hidden = plans.length === 0;
        noPlans.hidden = plans.length > 0;
      } catch (err) {
        showMessage(message, "Couldn't load people, locations and plans: " + errorMessage(err), true);
      }
    }

    function collectTie() {
      /** @type {Record<string, any>} */
      const data = Object.fromEntries(new FormData(form));

      data.participants = [];
      for (const row of participantRows.children) {
        const personId = /** @type {HTMLSelectElement} */ ($(".person", row)).value;
        const role = /** @type {HTMLSelectElement} */ ($(".role", row)).value;
        if (!personId && !role) continue; // empty row
        if (!personId || !role) throw new Error("Choose a person and a role for each row, or remove it.");
        data.participants.push({ person_id: personId, role });
      }

      data.plan_ids = [...planRows.querySelectorAll("select")].map((s) => s.value).filter(Boolean);
      data.tags = tags;
      return data;
    }

    /** @param {SubmitEvent} event */
    async function save(event) {
      event.preventDefault();
      saveButton.disabled = true;
      showMessage(message, "Saving…");
      try {
        await api("/api/ties", { method: "POST", body: collectTie() });
        saved = true;
        dialog.close();
      } catch (err) {
        showMessage(message, "Couldn't save: " + errorMessage(err), true);
      } finally {
        saveButton.disabled = false;
      }
    }

    document.body.append(dialog);
    dialog.showModal();
    loadPickers();
  });
}
