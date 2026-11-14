// The "Add a tie" form, in a pop-up dialog opened from the + buttons. The
// same form edits a tie (opened from its title in the list), with Delete and
// Share icons beside its ✕.

import { api, errorMessage } from "./api.js";
import { h, $, showMessage, privateField, removeX } from "./dom.js";
import { choose } from "./dialog.js";
import { today, capitalise } from "./format.js";
import { pickTags } from "./tag-picker.js";
import { TIE_TYPES, planLabel } from "./ties-view.js";
import { searchPicker } from "./search-picker.js";
import { personRows } from "./person-rows.js";
import { pickerSource } from "./search-choices.js";
import { ratingPicker } from "./rope-rating.js";
import { WEB_LINK_PATTERN, webLinkOrNull } from "./links.js";
import { open } from "./vault.js";
import { saveTie, deleteTie, recentOnTies } from "./store/index.js";
import { visualSection } from "./visuals-ui.js";
import { openShareItem } from "./share-item-dialog.js";
import { dialogHeader, iconButton } from "./dialog-icons.js";
import { watchChanges, guardClose } from "./form-changes.js";
import { startEntry } from "./new-entry-start.js";
import { workshopLink } from "./workshop-link.js";

/** @type {Promise<boolean> | null} */
let openDialog = null;

/**
 * Opens the form, empty to log a tie, or filled in with a tie (as GET
 * /api/ties/:id returns it) to edit it. Resolves true once the tie is saved
 * or deleted (the dialog closes itself), or false if it's closed without
 * either. Opening it again while it's open returns the same promise.
 * @param {Record<string, any> | null} [tie]
 * @param {{ start?: import("./new-entry-start.js").EntryStart, fromWorkshop?: FromWorkshop }} [options]
 *   start: a new tie made from the poser on its own, with its pose;
 *   fromWorkshop: a new tie started from a workshop's "Ties and plans",
 *   linked to it, with its date, location and people (workshops-view.js)
 * @returns {Promise<boolean>}
 */
export function openTieForm(tie = null, { start, fromWorkshop } = {}) {
  openDialog ??= showTieForm(tie, start ?? null, fromWorkshop ?? null).finally(() => { openDialog = null; });
  return openDialog;
}

/** @typedef {ReturnType<typeof import("./workshops-view.js").tieFromWorkshop> & { title?: string }} FromWorkshop */

/**
 * @param {Record<string, any> | null} tie
 * @param {import("./new-entry-start.js").EntryStart | null} start
 * @param {FromWorkshop | null} fromWorkshop
 * @returns {Promise<boolean>}
 */
function showTieForm(tie, start, fromWorkshop) {
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
    /** @type {string[]} tag names; new ones are created when the tie is saved */
    let tags = [...(tie?.tags ?? [])];

    // Ids start with "tie-" because this dialog opens on top of pages whose own
    // forms use ids like #title and #notes.
    const message = h("p", { className: "message", id: "tie-message" });
    /** @param {string} text */
    const onError = (text) => showMessage(message, text, true);
    // The first person row added to a new tie starts with me in it.
    // A tie from a workshop starts with the workshop's people instead.
    const participants = personRows({
      id: "tie-participants", idPrefix: "tie-person", source: sources.people, onError, startWithMe: !tie && !fromWorkshop,
    });
    const workshop = workshopLink({ idPrefix: "tie", onError });
    const planRows = h("div", { id: "tie-plans" });
    // The location box is hidden until the + after its label is tapped.
    const location = searchPicker({
      kind: "locations", id: "tie-location", label: { labelledBy: "tie-location-label" },
      source: sources.locations, input: { name: "location_id" }, onError,
    });
    const showLocationButton = addButton("tie-location-show", "Add location", showLocation);
    const locationRow = h("div", { className: "picker-row removable", hidden: true },
      location.element,
      Object.assign(removeX("Remove location", removeLocation), { id: "tie-location-remove" }));
    // Editing a tie whose location was deleted: shown until it's removed.
    const deletedLocationRow = h("div", { className: "picker-row removable kept-deleted", id: "tie-location-deleted", hidden: true },
      h("span", { className: "deleted" }, "(location deleted)"),
      removeX("Remove location", removeDeletedLocation));
    const addParticipantButton = addButton("tie-add-participant", "Add person", () => participants.add());
    const addPlanButton = addButton("tie-add-plan", "Add plan", () => addPlanRow());
    const tagList = h("div", { className: "tag-row", id: "tie-tags" });
    const saveButton = h("button", { type: "submit", className: "primary", id: "tie-save" }, tie ? "Save changes" : "Save tie");
    const visuals = visualSection({ item: tie ? { tie_id: tie.id } : null, idPrefix: "tie" });

    const form = h("form", { id: "tie-form", onsubmit: save },
      h("label", { htmlFor: "tie-title" }, "Title"),
      privateField(h("input", { id: "tie-title", name: "title", placeholder: "e.g. Hip harness to futomomo" })),
      h("div", { className: "row same-height" },
        h("div", { className: "date-field" },
          h("label", { htmlFor: "tie-tie_date" }, "Date"),
          privateField(h("input", { id: "tie-tie_date", name: "tie_date", type: "date", value: today(), required: true }))),
        h("div", {},
          h("label", { htmlFor: "tie-tie_type" }, "Type"),
          // Required (migration 0014): "–" until a type is chosen.
          h("select", { id: "tie-tie_type", name: "tie_type", required: true },
            h("option", { value: "" }, "–"),
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
      workshop.element,
      h("div", { className: "label-row" }, h("label", {}, "People"), addParticipantButton),
      participants.element,
      h("div", { className: "label-row" },
        h("label", { id: "tie-rating-label" }, "How did it go?"),
        ratingPicker({ name: "success_rating", labelledBy: "tie-rating-label", value: tie?.success_rating ?? null })),
      h("label", { htmlFor: "tie-notes" }, "Notes"),
      privateField(h("textarea", { id: "tie-notes", name: "notes", placeholder: "What happened, what changed, what to try next" })),
      // Encrypted like the notes (crypto/fields.js).
      h("label", { htmlFor: "tie-album_url" }, "Album link"),
      privateField(h("input", {
        id: "tie-album_url", name: "album_url", type: "url", inputMode: "url", pattern: WEB_LINK_PATTERN,
        placeholder: "https://photos.app.goo.gl/…", title: "A web address, starting with https://",
      })),
      visuals.element,
      h("div", { className: "label-row" }, h("label", {}, "Tags"), addButton("tie-add-tags", "Edit tags", chooseTags)),
      tagList,
      saveButton,
      message
    );

    // Unlike the confirmation dialogs, tapping outside doesn't close this
    // one, so a stray tap can't throw away a half-written tie. Esc and ✕
    // do, asking first if anything's changed.
    const heading = h("h2", { id: "tie-form-heading" }, tie ? "Edit tie" : "Add a tie");
    const dialog = h("dialog", { className: "form-dialog", "aria-labelledby": "tie-form-heading" },
      dialogHeader(heading, [
        tie ? iconButton("delete", { id: "tie-delete", label: "Delete tie", onclick: confirmDelete }) : null,
        // As last saved: the share is a copy of the tie, not of what's typed.
        tie ? iconButton("share", { id: "tie-share", label: "Share tie", onclick: () => shareTie() }) : null,
        iconButton("close", { id: "tie-close", label: "Close", onclick: () => close() }),
      ]),
      form);
    // Editing, Save changes waits for a change. Kept rows (deleted links)
    // have no fields, so they're counted here, with the tags and any
    // visuals waiting for a new tie to be saved.
    /** Set once a tie from the poser is filled in, at the end. @type {ReturnType<typeof startEntry> | null} */
    let fromPoser = null;
    const changes = watchChanges({
      form, button: saveButton, editing: () => !!tie, ignore: visuals.element,
      extra: () => [tags, [...form.querySelectorAll(".kept-deleted:not([hidden])")].length, visuals.waiting],
      unsaved: () => !!fromPoser?.unsaved(),
    });
    const close = guardClose(dialog, changes.changed, () => fromPoser?.discard() ?? null);
    dialog.addEventListener("close", () => {
      visuals.close();
      dialog.remove();
      resolve(saved || visuals.touched);
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
      return removeX("Remove", () => row.remove());
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
      const row = h("div", { className: "picker-row removable kept-deleted", "data-link-id": linkId }, h("span", {}, text));
      row.append(removeButton(row));
      rows.append(row);
    }

    // Plan rows: a search box whose hidden input has the class .plan,
    // which collectTie reads. Editing a tie, they start with its plans in
    // them. (People rows are person-rows.js.)
    /** @param {any} [existing] one of the tie's plans */
    function addPlanRow(existing) {
      if (existing && !existing.plan_id) {
        addDeletedRow(planRows, existing.id, h("span", { className: "deleted" }, planLabel(existing).text));
        return;
      }
      const row = h("div", { className: "picker-row removable" });
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
          // People are opened, for their aliases (searched too).
          api(`/api/${kind}?archived=all`).then((rows) => (kind === "people" ? open("person", rows) : rows)),
          recentOnTies(kind),
        ])));
        // Filled in place: the pickers already hold these objects.
        kinds.forEach((kind, i) => Object.assign(sources[kind], pickerSource(...loaded[i])));
        // Once loaded, so each person's usual role can fill in a role ties
        // don't have (audit).
        if (fromWorkshop && !savedId) {
          const untouched = !changes.changed();
          for (const p of fromWorkshop.people) participants.add(p);
          if (untouched) changes.reset();
        }
        startAtDefaultLocation();
      } catch (err) {
        showMessage(message, "Couldn't load people, locations and plans: " + errorMessage(err), true);
      }
    }

    // A new tie starts at my default location (Locations), unless a
    // location was chosen while they loaded. Editing a tie leaves its own.
    function startAtDefaultLocation() {
      if (tie || savedId || fromWorkshop || !locationRow.hidden) return;
      const home = sources.locations.active.find((item) => item.isDefault);
      if (!home) return;
      // Where a new tie starts, not a change (unless something else was).
      const untouched = !changes.changed();
      location.pick(home);
      locationRow.hidden = false;
      showLocationButton.hidden = true;
      if (untouched) changes.reset();
    }

    function collectTie() {
      /** @type {Record<string, any>} */
      const data = Object.fromEntries(new FormData(form));

      data.participants = participants.collect();

      data.plan_ids = chosenPlans();
      data.tags = tags;
      // Checked here: it's sealed before it's sent, so the server can't.
      data.album_url = webLinkOrNull(data.album_url);
      if (savedId) {
        /** @param {HTMLElement} rows */
        const kept = (rows) => [...rows.querySelectorAll(".kept-deleted")].map((row) => /** @type {HTMLElement} */ (row).dataset.linkId);
        data.keep_deleted = { participants: participants.kept(), plans: kept(planRows), location: !deletedLocationRow.hidden };
      }
      return data;
    }

    async function shareTie() {
      if (!tie) return;
      showMessage(message, "");
      try {
        await openShareItem("tie", tie);
      } catch (err) {
        showMessage(message, "Couldn't share it: " + errorMessage(err), true);
      }
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
        await deleteTie(tie.id);
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
      set("tie-album_url", t.album_url);
      if (t.unreadable?.length) {
        showMessage(message, "This tie's notes or album link can't be decrypted. Saving replaces them.", true);
      }
      if (t.location_id) {
        location.pick(linked(t.location_id, t.location_name));
        locationRow.hidden = false;
        showLocationButton.hidden = true;
      } else if (t.location_deleted) {
        deletedLocationRow.hidden = false;
        showLocationButton.hidden = true;
      }
      for (const p of t.participants) participants.add(p);
      for (const p of t.plans) addPlanRow(p);
      if (t.workshop_id) workshop.set(t.workshop_id, t.workshop_title);
      showTags();
    }

    /** A new tie from a workshop: linked to it, its date and location (its people come once loaded). @param {FromWorkshop} w */
    function startFrom(w) {
      workshop.set(w.workshop_id, w.workshop_title);
      /** @type {HTMLInputElement} */ ($("#tie-tie_date", form)).value = w.tie_date;
      /** @type {HTMLInputElement} */ ($("#tie-title", form)).value = w.title ?? "";
      if (w.location_id) {
        location.pick(linked(w.location_id, w.location_name ?? ""));
        locationRow.hidden = false;
        showLocationButton.hidden = true;
      }
    }

    /** @param {SubmitEvent} event */
    async function save(event) {
      event.preventDefault();
      if (!changes.canSave()) return; // editing, with nothing changed
      if (visuals.busy) {
        showMessage(message, "Wait for the visuals to finish, then save.", true);
        return;
      }
      changes.busy(true);
      showMessage(message, "Saving…");
      try {
        savedId = await saveTie(savedId, collectTie());
        saved = true;
        if (visuals.waiting) {
          const problem = await visuals.savePending({ tie_id: /** @type {string} */ (savedId) });
          if (problem) {
            showMessage(message, `The tie is saved, but a visual couldn't be saved: ${problem} Save again to try again.`, true);
            return;
          }
        }
        fromPoser?.saved(/** @type {string} */ (savedId));
        dialog.close();
      } catch (err) {
        showMessage(message, "Couldn't save: " + errorMessage(err), true);
      } finally {
        changes.busy(false);
      }
    }

    if (tie) fill(tie);
    else if (fromWorkshop) startFrom(fromWorkshop);
    changes.reset();
    if (!tie && start) {
      fromPoser = startEntry({
        start, kind: "tie", form, visuals, titleInput: /** @type {HTMLInputElement} */ ($("#tie-title", form)),
      });
    }
    document.body.append(dialog);
    dialog.showModal();
    // A saved tie opens on its heading, not a text box (which would open
    // the keyboard); a new one, on its title.
    (tie ? heading : /** @type {HTMLElement} */ ($("#tie-title", form))).focus();
    loadPickers();
  });
}
