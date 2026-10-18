// The "Log a tie" form, in a pop-up dialog opened from the + button. The
// same form edits a tie (opened from its title in the list), with a Delete
// button too.

import { api, errorMessage } from "./api.js";
import { h, $, showMessage, privateField } from "./dom.js";
import { choose } from "./dialog.js";
import { today, capitalise } from "./format.js";
import { pickTags } from "./tag-picker.js";
import { TIE_TYPES, participantLabel, planLabel } from "./ties-view.js";
import { roleName, roleOptions } from "./roles.js";
import { searchPicker } from "./search-picker.js";
import { pickerSource } from "./search-choices.js";
import { ratingPicker } from "./rope-rating.js";
import { sealOne, forgetSearch } from "./vault.js";
import { photoSection } from "./photos-ui.js";

/** @type {Promise<boolean> | null} */
let openDialog = null;

/**
 * Opens the form, empty to log a tie, or filled in with a tie (as GET
 * /api/ties/:id returns it) to edit it. Resolves true once the tie is saved
 * or deleted (the dialog closes itself), or false if it's closed without
 * either. Opening it again while it's open returns the same promise.
 * @param {Record<string, any> | null} [tie]
 * @returns {Promise<boolean>}
 */
export function openTieForm(tie = null) {
  openDialog ??= showTieForm(tie).finally(() => { openDialog = null; });
  return openDialog;
}

/**
 * @param {Record<string, any> | null} tie
 * @returns {Promise<boolean>}
 */
function showTieForm(tie) {
  return new Promise((resolve) => {
    let saved = false;
    // The tie's id once it's saved: a new tie whose photos didn't all
    // upload stays open, and saving again edits it rather than adding another.
    let savedId = tie?.id ?? null;
    // Each kind's items, shared by its pickers (so one added in one row is
    // offered in the others). Filled in once loaded.
    const sources = {
      locations: pickerSource([], []),
      people: pickerSource([], []),
      plans: pickerSource([], []),
    };
    let rowCount = 0;
    // The first person row added to a new tie starts with me in it.
    let addedPerson = !!tie;
    /** @type {string[]} tag names; new ones are created when the tie is saved */
    let tags = [...(tie?.tags ?? [])];

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
    // Editing a tie whose location was deleted: shown until it's removed.
    const deletedLocationRow = h("div", { className: "picker-row kept-deleted", id: "tie-location-deleted", hidden: true },
      h("span", { className: "deleted" }, "(location deleted)"),
      h("button", { type: "button", "aria-label": "Remove location", onclick: removeDeletedLocation }, "✕"));
    const addParticipantButton = addButton("tie-add-participant", "Add person", () => addParticipantRow());
    const addPlanButton = addButton("tie-add-plan", "Add plan", () => addPlanRow());
    const tagList = h("div", { className: "tag-row", id: "tie-tags" });
    const saveButton = h("button", { type: "submit", className: "primary", id: "tie-save" }, "Save tie");
    const photos = photoSection({ item: tie ? { tie_id: tie.id } : null, idPrefix: "tie" });

    const form = h("form", { id: "tie-form", onsubmit: save },
      h("label", { htmlFor: "tie-title" }, "Title"),
      privateField(h("input", { id: "tie-title", name: "title", placeholder: "e.g. Hip harness to futomomo" })),
      h("div", { className: "row same-height" },
        h("div", { className: "date-field" },
          h("label", { htmlFor: "tie-tie_date" }, "Date"),
          privateField(h("input", { id: "tie-tie_date", name: "tie_date", type: "date", value: today(), required: true }))),
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
          locationRow, deletedLocationRow),
        h("div", {},
          h("div", { className: "label-row" }, h("label", {}, "Plans"), addPlanButton),
          planRows)),
      h("div", { className: "label-row" }, h("label", {}, "People"), addParticipantButton),
      participantRows,
      h("div", { className: "label-row" },
        h("label", { id: "tie-rating-label" }, "How did it go?"),
        ratingPicker({ name: "success_rating", labelledBy: "tie-rating-label", value: tie?.success_rating ?? null })),
      h("label", { htmlFor: "tie-notes" }, "Notes"),
      privateField(h("textarea", { id: "tie-notes", name: "notes", placeholder: "What happened, what changed, what to try next" })),
      photos.element,
      h("div", { className: "label-row" }, h("label", {}, "Tags"), addButton("tie-add-tags", "Edit tags", chooseTags)),
      tagList,
      saveButton,
      h("button", { type: "button", className: "dialog-cancel", onclick: () => dialog.close() }, "Cancel"),
      tie ? h("button", { type: "button", className: "danger dialog-delete", id: "tie-delete", onclick: confirmDelete }, "Delete tie") : null,
      message
    );

    // Unlike the confirmation dialogs, tapping outside doesn't close this
    // one, so a stray tap can't throw away a half-written tie. Esc still does.
    const dialog = h("dialog", { className: "form-dialog", "aria-labelledby": "tie-form-heading" },
      h("h2", { id: "tie-form-heading" }, tie ? "Edit tie" : "Log a tie"),
      form);
    dialog.addEventListener("close", () => {
      photos.close();
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

    function removeDeletedLocation() {
      deletedLocationRow.hidden = true;
      showLocationButton.hidden = false;
      showLocationButton.focus();
    }

    function removeLocation() {
      location.clear();
      locationRow.hidden = true;
      showLocationButton.hidden = false;
      showLocationButton.focus();
    }

    /**
     * A link on the tie being edited to a person or plan since deleted: it
     * can be removed but not changed. Kept rows are sent in keep_deleted.
     * @param {HTMLElement} rows
     * @param {string} linkId the link row's id
     * @param {any[]} text
     */
    function addDeletedRow(rows, linkId, ...text) {
      const row = h("div", { className: "picker-row kept-deleted", "data-link-id": linkId }, h("span", {}, text));
      row.append(removeButton(row));
      rows.append(row);
    }

    // People and plan rows: a search box whose hidden input has the class
    // .person or .plan, which collectTie reads. Editing a tie, they start
    // with its people and plans in them.
    /** @param {any} [existing] one of the tie's participants */
    function addParticipantRow(existing) {
      if (existing && !existing.person_id) {
        const { name, role } = participantLabel(existing);
        addDeletedRow(participantRows, existing.id, h("span", { className: "deleted" }, name.text), ` (${roleName(role)})`);
        return;
      }
      const row = h("div", { className: "picker-row person-row" });
      const role = h("select", { className: "role", "aria-label": "Role" },
        h("option", { value: "" }, "Role"),
        roleOptions().map((r) => h("option", { value: r.value }, r.label)));
      const person = searchPicker({
        kind: "people", id: `tie-person-${++rowCount}`, label: { text: "Person" },
        source: sources.people, input: { className: "person" }, onError,
        // Picking someone sets their usual role (or none), replacing any
        // role chosen for whoever was there before. It can still be changed.
        onPick: (item) => { role.value = item.defaultRole ?? ""; },
      });
      row.append(person.element, role, removeButton(row));
      participantRows.append(row);

      if (existing) {
        person.pick(linked(existing.person_id, existing.person_name));
        role.value = existing.role; // after pick, which sets their usual role
        return;
      }
      const me = sources.people.active.find((item) => item.isSelf);
      if (!addedPerson && me) {
        person.pick(me);
        role.focus();
      } else {
        person.focus();
      }
      addedPerson = true;
    }

    /** @param {any} [existing] one of the tie's plans */
    function addPlanRow(existing) {
      if (existing && !existing.plan_id) {
        addDeletedRow(planRows, existing.id, h("span", { className: "deleted" }, planLabel(existing).text));
        return;
      }
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
      if (existing) plan.pick(linked(existing.plan_id, existing.plan_title));
      else plan.focus();
    }

    function chosenPlans() {
      return [...planRows.querySelectorAll(".plan")].map((input) => /** @type {HTMLInputElement} */ (input).value).filter(Boolean);
    }

    async function chooseTags() {
      const picked = await pickTags(tags);
      if (picked === null) return; // closed with Esc: keep what was chosen before
      tags = picked;
      showTags();
    }

    function showTags() {
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
        startAtDefaultLocation();
      } catch (err) {
        showMessage(message, "Couldn't load people, locations and plans: " + errorMessage(err), true);
      }
    }

    // A new tie starts at my default location (Locations), unless a
    // location was chosen while they loaded. Editing a tie leaves its own.
    function startAtDefaultLocation() {
      if (tie || savedId || !locationRow.hidden) return;
      const home = sources.locations.active.find((item) => item.isDefault);
      if (!home) return;
      location.pick(home);
      locationRow.hidden = false;
      showLocationButton.hidden = true;
    }

    function collectTie() {
      /** @type {Record<string, any>} */
      const data = Object.fromEntries(new FormData(form));

      data.participants = [];
      for (const row of participantRows.querySelectorAll(".person-row")) {
        const personId = /** @type {HTMLInputElement} */ ($(".person", row)).value;
        const role = /** @type {HTMLSelectElement} */ ($(".role", row)).value;
        if (!personId && !role) continue; // empty row
        if (!personId || !role) throw new Error("Choose a person and a role for each row, or remove it.");
        data.participants.push({ person_id: personId, role });
      }

      data.plan_ids = chosenPlans();
      data.tags = tags;
      if (savedId) {
        /** @param {HTMLElement} rows */
        const kept = (rows) => [...rows.querySelectorAll(".kept-deleted")].map((row) => /** @type {HTMLElement} */ (row).dataset.linkId);
        data.keep_deleted = { participants: kept(participantRows), plans: kept(planRows), location: !deletedLocationRow.hidden };
      }
      return data;
    }

    async function confirmDelete() {
      const choice = await choose({
        title: "Delete this tie?",
        message: "It'll be gone for good. Its people, location, plans and tags stay.",
        choices: [{ label: "Delete tie", value: "delete", style: "solid-danger" }],
      });
      if (choice !== "delete" || !tie) return;
      showMessage(message, "Deleting…");
      try {
        await api(`/api/ties/${encodeURIComponent(tie.id)}`, { method: "DELETE" });
        forgetSearch();
        saved = true;
        dialog.close();
      } catch (err) {
        showMessage(message, "Couldn't delete: " + errorMessage(err), true);
      }
    }

    /**
     * A person, location or plan already on the tie, to show in its picker
     * (archived ones too: they stay on the tie, still archived).
     * @param {string} id
     * @param {string} name
     */
    function linked(id, name) {
      return { id, name, created_at: "" };
    }

    /** Puts the tie being edited into the form. @param {Record<string, any>} t */
    function fill(t) {
      /** @param {string} id @param {unknown} value */
      const set = (id, value) => { /** @type {HTMLInputElement} */ ($(`#${id}`, form)).value = value == null ? "" : String(value); };
      set("tie-title", t.title);
      set("tie-tie_date", t.tie_date);
      set("tie-tie_type", t.tie_type);
      set("tie-duration_minutes", t.duration_minutes);
      set("tie-notes", t.notes);
      if (t.unreadable?.length) showMessage(message, "This tie's notes can't be decrypted. Saving replaces them.", true);
      if (t.location_id) {
        location.pick(linked(t.location_id, t.location_name));
        locationRow.hidden = false;
        showLocationButton.hidden = true;
      } else if (t.location_deleted) {
        deletedLocationRow.hidden = false;
        showLocationButton.hidden = true;
      }
      for (const p of t.participants) addParticipantRow(p);
      for (const p of t.plans) addPlanRow(p);
      showTags();
    }

    /** @param {SubmitEvent} event */
    async function save(event) {
      event.preventDefault();
      if (photos.busy) {
        showMessage(message, "Wait for the photos to finish, then save.", true);
        return;
      }
      saveButton.disabled = true;
      showMessage(message, "Saving…");
      try {
        // The notes are sealed here, on the device, before they're sent.
        const body = await sealOne("tie", collectTie());
        if (savedId) await api(`/api/ties/${encodeURIComponent(savedId)}`, { method: "PUT", body });
        else savedId = (await api("/api/ties", { method: "POST", body })).id;
        // The search index has this tie's old notes (or none): fetch it afresh.
        forgetSearch();
        saved = true;
        if (photos.waiting) {
          const problem = await photos.uploadPending({ tie_id: /** @type {string} */ (savedId) });
          if (problem) {
            showMessage(message, `The tie is saved, but a photo couldn't be uploaded: ${problem} Save again to try again.`, true);
            return;
          }
        }
        dialog.close();
      } catch (err) {
        showMessage(message, "Couldn't save: " + errorMessage(err), true);
      } finally {
        saveButton.disabled = false;
      }
    }

    if (tie) fill(tie);
    document.body.append(dialog);
    dialog.showModal();
    loadPickers();
  });
}
