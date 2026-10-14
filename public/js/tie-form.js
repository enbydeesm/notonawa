// The "Log a tie" form, in a pop-up dialog opened from the + button.

import { api, errorMessage } from "./api.js";
import { h, $, showMessage, privateField } from "./dom.js";
import { today, capitalise } from "./format.js";
import { pickTags } from "./tag-picker.js";
import { ROLES, TIE_TYPES } from "./ties-view.js";
import { searchPicker } from "./search-picker.js";
import { pickerSource } from "./search-choices.js";
import { ratingPicker } from "./rope-rating.js";

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
    // Each kind's items, shared by its pickers (so one added in one row is
    // offered in the others). Filled in once loaded.
    const sources = {
      locations: pickerSource([], []),
      people: pickerSource([], []),
      plans: pickerSource([], []),
    };
    let rowCount = 0;
    // The first person row added starts with me in it.
    let addedPerson = false;
    /** @type {string[]} tag names; new ones are created when the tie is saved */
    let tags = [];

    // Ids start with "tie-" because this dialog opens on top of pages whose own
    // forms use ids like #title and #notes.
    const message = h("p", { className: "message", id: "tie-message" });
    const participantRows = h("div", { id: "tie-participants" });
    const planRows = h("div", { id: "tie-plans" });
    /** @param {string} text */
    const onError = (text) => showMessage(message, text, true);
    // The location box is hidden until the + after its label is tapped.
    const location = searchPicker({
      kind: "locations", id: "tie-location", label: { labelledBy: "tie-location-label" },
      source: sources.locations, input: { name: "location_id" }, onError,
    });
    const showLocationButton = addButton("tie-location-show", "Add location", showLocation);
    const locationRow = h("div", { className: "picker-row", hidden: true },
      location.element,
      h("button", { type: "button", id: "tie-location-remove", "aria-label": "Remove location", onclick: removeLocation }, "✕"));
    const addParticipantButton = addButton("tie-add-participant", "Add person", addParticipantRow);
    const addPlanButton = addButton("tie-add-plan", "Add plan", addPlanRow);
    const tagList = h("div", { className: "tag-row", id: "tie-tags" });
    const saveButton = h("button", { type: "submit", className: "primary", id: "tie-save" }, "Save tie");

    const form = h("form", { id: "tie-form", onsubmit: save },
      h("label", { htmlFor: "tie-title" }, "Title"),
      privateField(h("input", { id: "tie-title", name: "title", placeholder: "e.g. Hip harness to futomomo" })),
      h("div", { className: "row same-height" },
        h("div", { className: "date-field" },
          h("label", { htmlFor: "tie-tie_date" }, "Date"),
          privateField(h("input", { id: "tie-tie_date", name: "tie_date", type: "date", value: today() }))),
        h("div", {},
          h("label", { htmlFor: "tie-tie_type" }, "Type"),
          h("select", { id: "tie-tie_type", name: "tie_type" },
            h("option", { value: "" }, "Not set"),
            TIE_TYPES.map((t) => h("option", { value: t }, capitalise(t))))),
        h("div", { className: "minutes-field" },
          h("label", { htmlFor: "tie-duration_minutes" }, "Mins"),
          privateField(h("input", { id: "tie-duration_minutes", name: "duration_minutes", type: "number", min: "0", max: "1440", inputMode: "numeric" })))),
      // Location and plans share a row, each a label with a small + after it.
      h("div", { className: "row" },
        h("div", {},
          h("div", { className: "label-row" },
            h("label", { htmlFor: "tie-location", id: "tie-location-label" }, "Location"), showLocationButton),
          locationRow),
        h("div", {},
          h("div", { className: "label-row" }, h("label", {}, "Plans"), addPlanButton),
          planRows)),
      h("div", { className: "label-row" }, h("label", {}, "People"), addParticipantButton),
      participantRows,
      h("div", { className: "label-row" },
        h("label", { id: "tie-rating-label" }, "How did it go?"),
        ratingPicker({ name: "success_rating", labelledBy: "tie-rating-label" })),
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

    function showLocation() {
      locationRow.hidden = false;
      showLocationButton.hidden = true;
      location.focus();
    }

    function removeLocation() {
      location.clear();
      locationRow.hidden = true;
      showLocationButton.hidden = false;
      showLocationButton.focus();
    }

    // People and plan rows: a search box whose hidden input has the class
    // .person or .plan, which collectTie reads.
    function addParticipantRow() {
      const row = h("div", { className: "picker-row person-row" });
      const role = h("select", { className: "role", "aria-label": "Role" },
        h("option", { value: "" }, "Role"),
        ROLES.map((r) => h("option", { value: r }, capitalise(r))));
      const person = searchPicker({
        kind: "people", id: `tie-person-${++rowCount}`, label: { text: "Person" },
        source: sources.people, input: { className: "person" }, onError,
        // Picking someone sets their usual role (or none), replacing any
        // role chosen for whoever was there before. It can still be changed.
        onPick: (item) => { role.value = item.defaultRole ?? ""; },
      });
      row.append(person.element, role, removeButton(row));
      participantRows.append(row);

      const me = sources.people.active.find((item) => item.isSelf);
      if (!addedPerson && me) {
        person.pick(me);
        role.focus();
      } else {
        person.focus();
      }
      addedPerson = true;
    }

    function addPlanRow() {
      const row = h("div", { className: "picker-row" });
      const plan = searchPicker({
        kind: "plans", id: `tie-plan-${++rowCount}`, label: { text: "Plan" },
        source: sources.plans, input: { className: "plan" }, onError,
        // A plan is linked once, so ones chosen in other rows aren't offered.
        exclude: () => new Set(chosenPlans().filter((id) => id !== hidden.value)),
      });
      const hidden = /** @type {HTMLInputElement} */ ($(".plan", plan.element));
      row.append(plan.element, removeButton(row));
      planRows.append(row);
      plan.focus();
    }

    function chosenPlans() {
      return [...planRows.querySelectorAll(".plan")].map((input) => /** @type {HTMLInputElement} */ (input).value).filter(Boolean);
    }

    async function chooseTags() {
      const picked = await pickTags(tags);
      if (picked === null) return; // closed with Esc: keep what was chosen before
      tags = picked;
      tagList.replaceChildren(...tags.map((name) => h("span", { className: "tag outline" }, name)));
    }

    async function loadPickers() {
      try {
        // Archived ones too, so typing an archived name points to restoring
        // it instead of adding a second one.
        const kinds = /** @type {const} */ (["locations", "people", "plans"]);
        const loaded = await Promise.all(kinds.map((kind) => Promise.all([
          api(`/api/${kind}?archived=all`), api(`/api/ties/recent/${kind}`),
        ])));
        // Filled in place: the pickers already hold these objects.
        kinds.forEach((kind, i) => Object.assign(sources[kind], pickerSource(...loaded[i])));
      } catch (err) {
        showMessage(message, "Couldn't load people, locations and plans: " + errorMessage(err), true);
      }
    }

    function collectTie() {
      /** @type {Record<string, any>} */
      const data = Object.fromEntries(new FormData(form));

      data.participants = [];
      for (const row of participantRows.children) {
        const personId = /** @type {HTMLInputElement} */ ($(".person", row)).value;
        const role = /** @type {HTMLSelectElement} */ ($(".role", row)).value;
        if (!personId && !role) continue; // empty row
        if (!personId || !role) throw new Error("Choose a person and a role for each row, or remove it.");
        data.participants.push({ person_id: personId, role });
      }

      data.plan_ids = chosenPlans();
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
