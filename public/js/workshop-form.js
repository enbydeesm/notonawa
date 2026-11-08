// The "Add a workshop" form, in a pop-up dialog opened from the Education
// view's + (and from a workshop's title, to edit or delete it). Educators
// are chosen from the people marked Educator on People; my own profile is
// offered there only once it's marked too, and a workshop with me as an
// educator is one I taught.

import { api, errorMessage } from "./api.js";
import { h, $, showMessage, privateField, removeX, infoTip } from "./dom.js";
import { choose } from "./dialog.js";
import { today } from "./format.js";
import { pickTags } from "./tag-picker.js";
import { searchPicker } from "./search-picker.js";
import { pickerSource } from "./search-choices.js";
import { personRows } from "./person-rows.js";
import { ratingPicker } from "./rope-rating.js";
import { WEB_LINK_PATTERN, webLinkOrNull } from "./links.js";
import { sealOne, open } from "./vault.js";
import { visualSection } from "./visuals-ui.js";
import { openShareItem } from "./share-item-dialog.js";
import { dialogHeader, iconButton } from "./dialog-icons.js";
import { watchChanges, guardClose } from "./form-changes.js";
import { startEntry } from "./new-entry-start.js";

/** @type {Promise<boolean> | null} */
let openDialog = null;

/**
 * Opens the form, empty to add a workshop, or filled in with one (as GET
 * /api/workshops/:id returns it, opened) to edit it. Resolves true once
 * it's saved or deleted, false if it's closed without either. Opening it
 * again while it's open returns the same promise.
 * @param {Record<string, any> | null} [workshop]
 * @param {{ start?: import("./new-entry-start.js").EntryStart }} [options]
 *   start: a new workshop made from the poser on its own, with its pose
 * @returns {Promise<boolean>}
 */
export function openWorkshopForm(workshop = null, { start } = {}) {
  openDialog ??= showWorkshopForm(workshop, start ?? null).finally(() => { openDialog = null; });
  return openDialog;
}

/**
 * Opens one of my workshops in the form (its notes opened on the device
 * first). Resolves true if it was saved or deleted. Throws if it can't be
 * loaded.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function editWorkshop(id) {
  const [workshop] = await open("workshop", [await api(`/api/workshops/${encodeURIComponent(id)}`)]);
  return openWorkshopForm(workshop);
}

/**
 * @param {Record<string, any> | null} workshop
 * @param {import("./new-entry-start.js").EntryStart | null} start
 * @returns {Promise<boolean>}
 */
function showWorkshopForm(workshop, start) {
  return new Promise((resolve) => {
    let saved = false;
    // Its id once saved: a new one whose photos didn't all upload stays
    // open, and saving again edits it rather than adding another.
    let savedId = workshop?.id ?? null;
    // Filled in once loaded. Educators: only people marked Educator; the
    // rest are `elsewhere`, so typing one points to People instead of
    // offering to add them again.
    const sources = {
      locations: pickerSource([], []),
      people: pickerSource([], []),
      educators: pickerSource([], []),
    };
    /** @type {string[]} tag names; new ones are created when it's saved */
    let tags = [...(workshop?.tags ?? [])];

    // Ids start with "workshop-": this dialog opens over a view with its
    // own form fields.
    const message = h("p", { className: "message", id: "workshop-message" });
    /** @param {string} text */
    const onError = (text) => showMessage(message, text, true);
    // Someone is on a workshop once: as an educator or a participant.
    const chosen = () => new Set([...educators.chosenIds(), ...participants.chosenIds()]);
    const educators = personRows({
      id: "workshop-educators", idPrefix: "workshop-educator", source: sources.educators, onError, exclude: chosen, workshop: true,
      picker: {
        // Someone added here teaches.
        newFields: { is_educator: 1 },
        onAdd: (item, archived) => (archived ? sources.people.archived : sources.people.active).push(item),
        elsewhereNote: (name) => `"${name}" isn't marked as an educator. Tick Educator on them in People to choose them here.`,
      },
    });
    const participants = personRows({
      id: "workshop-participants", idPrefix: "workshop-participant", source: sources.people, onError, exclude: chosen, workshop: true,
      picker: { onAdd: (item) => (sources.educators.elsewhere ??= []).push(item) },
    });
    // Behind a "?" beside Educators, shown once my own profile isn't marked Educator.
    const selfHint = infoTip("workshop-self-hint", "About logging a workshop you taught",
      "To log a workshop you taught, tick Educator on your own profile in People.");
    selfHint.button.hidden = true;

    const location = searchPicker({
      kind: "locations", id: "workshop-location", label: { labelledBy: "workshop-location-label" },
      source: sources.locations, input: { name: "location_id" }, onError,
    });
    const showLocationButton = addButton("workshop-location-show", "Add location", showLocation);
    const locationRow = h("div", { className: "picker-row removable", hidden: true },
      location.element,
      Object.assign(removeX("Remove location", removeLocation), { id: "workshop-location-remove" }));
    const deletedLocationRow = h("div", { className: "picker-row removable kept-deleted", id: "workshop-location-deleted", hidden: true },
      h("span", { className: "deleted" }, "(location deleted)"),
      removeX("Remove location", removeDeletedLocation));
    const tagList = h("div", { className: "tag-row", id: "workshop-tags" });
    const saveButton = h("button", { type: "submit", className: "primary", id: "workshop-save" }, workshop ? "Save changes" : "Save workshop");
    const visuals = visualSection({ item: workshop ? { workshop_id: workshop.id } : null, idPrefix: "workshop" });
    const startInput = privateField(h("input", {
      id: "workshop-start_date", name: "start_date", type: "date", value: today(), required: true,
      onchange: () => { endInput.min = startInput.value; },
    }));
    const endInput = privateField(h("input", { id: "workshop-end_date", name: "end_date", type: "date", min: today() }));

    const form = h("form", { id: "workshop-form", onsubmit: save },
      h("label", { htmlFor: "workshop-title" }, "Title"),
      privateField(h("input", { id: "workshop-title", name: "title", required: true, maxLength: 200, placeholder: "e.g. Intro to floor work" })),
      h("div", { className: "row" },
        h("div", { className: "date-field" }, h("label", { htmlFor: "workshop-start_date" }, "Start date"), startInput),
        h("div", { className: "date-field" }, h("label", { htmlFor: "workshop-end_date" }, "End date (optional)"), endInput)),
      h("div", { className: "row" },
        h("div", {},
          h("div", { className: "label-row" },
            h("label", { htmlFor: "workshop-location", id: "workshop-location-label" }, "Location"), showLocationButton),
          locationRow, deletedLocationRow),
        h("div", { className: "minutes-field" },
          h("label", { htmlFor: "workshop-attendee_count" }, "Attendees"),
          privateField(h("input", {
            id: "workshop-attendee_count", name: "attendee_count", type: "number", min: "0", max: "100000", inputMode: "numeric",
            placeholder: "10",
          })))),
      h("div", { className: "label-row" },
        h("label", {}, "Educators"), addButton("workshop-add-educator", "Add educator", () => educators.add()), selfHint.button),
      selfHint.text,
      educators.element,
      h("div", { className: "label-row" },
        h("label", {}, "Participants"), addButton("workshop-add-participant", "Add participant", () => participants.add())),
      participants.element,
      h("div", { className: "label-row" },
        h("label", { id: "workshop-rating-label" }, "How was it?"),
        ratingPicker({ name: "rating", labelledBy: "workshop-rating-label", value: workshop?.rating ?? null })),
      h("label", { htmlFor: "workshop-description" }, "Workshop description"),
      privateField(h("textarea", { id: "workshop-description", name: "description", placeholder: "What it covered" })),
      h("label", { htmlFor: "workshop-notes" }, "Notes"),
      privateField(h("textarea", { id: "workshop-notes", name: "notes", placeholder: "What you learned, what to practise" })),
      // Encrypted like the notes (crypto/fields.js).
      h("label", { htmlFor: "workshop-album_url" }, "Album link"),
      privateField(h("input", {
        id: "workshop-album_url", name: "album_url", type: "url", inputMode: "url", pattern: WEB_LINK_PATTERN,
        placeholder: "https://photos.app.goo.gl/…", title: "A web address, starting with https://",
      })),
      visuals.element,
      h("div", { className: "label-row" }, h("label", {}, "Tags"), addButton("workshop-add-tags", "Edit tags", chooseTags)),
      tagList,
      saveButton,
      message
    );

    // As with the tie form, tapping outside doesn't close it (a stray tap
    // can't throw away a half-written workshop); Esc and ✕ do, asking
    // first if anything's changed.
    const heading = h("h2", { id: "workshop-form-heading" }, workshop ? "Edit workshop" : "Add a workshop");
    const dialog = h("dialog", { className: "form-dialog", "aria-labelledby": "workshop-form-heading" },
      dialogHeader(heading, [
        workshop ? iconButton("delete", { id: "workshop-delete", label: "Delete workshop", onclick: confirmDelete }) : null,
        // As last saved: the share is a copy of the workshop, not of what's typed.
        workshop ? iconButton("share", { id: "workshop-share", label: "Share workshop", onclick: () => shareWorkshop() }) : null,
        iconButton("close", { id: "workshop-close", label: "Close", onclick: () => close() }),
      ]),
      form);
    // As on the tie form: kept rows, tags and visuals waiting count too.
    /** Set once a workshop from the poser is filled in, at the end. @type {ReturnType<typeof startEntry> | null} */
    let fromPoser = null;
    const changes = watchChanges({
      form, button: saveButton, editing: () => !!workshop, ignore: visuals.element,
      extra: () => [tags, [...form.querySelectorAll(".kept-deleted:not([hidden])")].length, visuals.waiting],
      unsaved: () => !!fromPoser?.unsaved(),
    });
    const close = guardClose(dialog, changes.changed, () => fromPoser?.discard() ?? null);
    dialog.addEventListener("close", () => {
      visuals.close();
      dialog.remove();
      resolve(saved);
    });

    /**
     * The small + after a section's label.
     * @param {string} id
     * @param {string} label
     * @param {() => void} onclick
     */
    function addButton(id, label, onclick) {
      return h("button", { type: "button", className: "label-add", id, "aria-label": label, title: label, onclick }, "+");
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

    function removeDeletedLocation() {
      deletedLocationRow.hidden = true;
      showLocationButton.hidden = false;
      showLocationButton.focus();
    }

    async function chooseTags() {
      const picked = await pickTags(tags, { noun: "workshop" });
      if (picked === null) return;
      tags = picked;
      showTags();
    }

    function showTags() {
      tagList.replaceChildren(...tags.map((name) => h("span", { className: "tag outline" }, name)));
    }

    async function loadPickers() {
      try {
        // Archived ones too, so typing an archived name points to restoring
        // it instead of adding a second one. People are opened, for their
        // aliases (searched too).
        const [people, locations, recentPeople, recentLocations] = await Promise.all([
          api("/api/people?archived=all").then((rows) => open("person", rows)),
          api("/api/locations?archived=all"),
          api("/api/ties/recent/people"),
          api("/api/ties/recent/locations"),
        ]);
        // Filled in place: the pickers already hold these objects.
        Object.assign(sources.people, pickerSource(people, recentPeople));
        Object.assign(sources.locations, pickerSource(locations, recentLocations));
        const others = pickerSource(people.filter((p) => !p.is_educator), []);
        Object.assign(sources.educators, {
          ...pickerSource(people.filter((p) => p.is_educator), recentPeople),
          elsewhere: [...others.active, ...others.archived],
        });
        selfHint.button.hidden = !people.some((p) => p.is_self && !p.is_educator);
        startAtDefaultLocation();
      } catch (err) {
        showMessage(message, "Couldn't load people and locations: " + errorMessage(err), true);
      }
    }

    // A new workshop starts at my default location, as a new tie does.
    function startAtDefaultLocation() {
      if (workshop || savedId || !locationRow.hidden) return;
      const home = sources.locations.active.find((item) => item.isDefault);
      if (!home) return;
      // Where a new workshop starts, not a change (unless something else was).
      const untouched = !changes.changed();
      location.pick(home);
      locationRow.hidden = false;
      showLocationButton.hidden = true;
      if (untouched) changes.reset();
    }

    function collect() {
      /** @type {Record<string, any>} */
      const data = Object.fromEntries(new FormData(form));
      data.educators = educators.collect();
      data.participants = participants.collect();
      data.tags = tags;
      // Checked here: it's sealed before it's sent, so the server can't.
      data.album_url = webLinkOrNull(data.album_url);
      if (data.end_date && data.end_date < data.start_date) throw new Error("The end date is before the start date.");
      if (savedId) {
        data.keep_deleted = { people: [...educators.kept(), ...participants.kept()], location: !deletedLocationRow.hidden };
      }
      return data;
    }

    async function shareWorkshop() {
      if (!workshop) return;
      showMessage(message, "");
      try {
        await openShareItem("workshop", workshop);
      } catch (err) {
        showMessage(message, "Couldn't share it: " + errorMessage(err), true);
      }
    }

    async function confirmDelete() {
      const choice = await choose({
        title: "Delete this workshop?",
        message: "It'll be gone for good, with its photos, drawings and poses. Its people, location and tags stay.",
        choices: [{ label: "Delete workshop", value: "delete", style: "solid-danger" }],
      });
      if (choice !== "delete" || !workshop) return;
      showMessage(message, "Deleting…");
      try {
        await api(`/api/workshops/${encodeURIComponent(workshop.id)}`, { method: "DELETE" });
        saved = true;
        dialog.close();
      } catch (err) {
        showMessage(message, "Couldn't delete: " + errorMessage(err), true);
      }
    }

    /** Puts the workshop being edited into the form. @param {Record<string, any>} w */
    function fill(w) {
      /** @param {string} id @param {unknown} value */
      const set = (id, value) => { /** @type {HTMLInputElement} */ ($(`#${id}`, form)).value = value == null ? "" : String(value); };
      set("workshop-title", w.title);
      set("workshop-start_date", w.start_date);
      set("workshop-end_date", w.end_date);
      endInput.min = w.start_date;
      set("workshop-attendee_count", w.attendee_count);
      set("workshop-description", w.description);
      set("workshop-notes", w.notes);
      set("workshop-album_url", w.album_url);
      if (w.unreadable?.length) {
        showMessage(message, "This workshop's description, notes or album link can't be decrypted. Saving replaces them.", true);
      }
      if (w.location_id) {
        location.pick({ id: w.location_id, name: w.location_name, created_at: "" });
        locationRow.hidden = false;
        showLocationButton.hidden = true;
      } else if (w.location_deleted) {
        deletedLocationRow.hidden = false;
        showLocationButton.hidden = true;
      }
      for (const p of w.educators) educators.add(p);
      for (const p of w.participants) participants.add(p);
      showTags();
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
        // The description, notes and album link are sealed here, on the device.
        const body = await sealOne("workshop", collect());
        if (savedId) await api(`/api/workshops/${encodeURIComponent(savedId)}`, { method: "PUT", body });
        else savedId = (await api("/api/workshops", { method: "POST", body })).id;
        saved = true;
        if (visuals.waiting) {
          const problem = await visuals.savePending({ workshop_id: /** @type {string} */ (savedId) });
          if (problem) {
            showMessage(message, `The workshop is saved, but a visual couldn't be saved: ${problem} Save again to try again.`, true);
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

    if (workshop) fill(workshop);
    changes.reset();
    if (!workshop && start) {
      fromPoser = startEntry({
        start, kind: "workshop", form, visuals, titleInput: /** @type {HTMLInputElement} */ ($("#workshop-title", form)),
      });
    }
    document.body.append(dialog);
    dialog.showModal();
    // A saved workshop opens on its heading, not a text box (which would
    // open the keyboard); a new one, on its title.
    (workshop ? heading : /** @type {HTMLElement} */ ($("#workshop-title", form))).focus();
    loadPickers();
  });
}
