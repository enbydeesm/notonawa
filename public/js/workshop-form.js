// The "Add a workshop" form, in a pop-up dialog opened from the Education
// view's + (and from a workshop's title, to edit or delete it). Educators
// are chosen from the people marked Educator on People; my own profile is
// offered there only once it's marked too, and a workshop with me as an
// educator is one I taught.

import { api, errorMessage } from "./api.js";
import { h, $, showMessage, privateField } from "./dom.js";
import { choose } from "./dialog.js";
import { today } from "./format.js";
import { pickTags } from "./tag-picker.js";
import { searchPicker } from "./search-picker.js";
import { pickerSource } from "./search-choices.js";
import { personRows } from "./person-rows.js";
import { ratingPicker } from "./rope-rating.js";
import { WEB_LINK_PATTERN, webLinkOrNull } from "./links.js";
import { sealOne, open } from "./vault.js";
import { photoSection } from "./photos-ui.js";
import { drawingSection } from "./drawings-ui.js";
import { poseSection, intoPhotos } from "./poses-ui.js";

/** @type {Promise<boolean> | null} */
let openDialog = null;

/**
 * Opens the form, empty to add a workshop, or filled in with one (as GET
 * /api/workshops/:id returns it, opened) to edit it. Resolves true once
 * it's saved or deleted, false if it's closed without either. Opening it
 * again while it's open returns the same promise.
 * @param {Record<string, any> | null} [workshop]
 * @returns {Promise<boolean>}
 */
export function openWorkshopForm(workshop = null) {
  openDialog ??= showWorkshopForm(workshop).finally(() => { openDialog = null; });
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
 * @returns {Promise<boolean>}
 */
function showWorkshopForm(workshop) {
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
      id: "workshop-educators", idPrefix: "workshop-educator", source: sources.educators, onError, exclude: chosen,
      picker: {
        // Someone added here teaches.
        newFields: { is_educator: 1 },
        onAdd: (item, archived) => (archived ? sources.people.archived : sources.people.active).push(item),
        elsewhereNote: (name) => `"${name}" isn't marked as an educator. Tick Educator on them in People to choose them here.`,
      },
    });
    const participants = personRows({
      id: "workshop-participants", idPrefix: "workshop-participant", source: sources.people, onError, exclude: chosen,
      picker: { onAdd: (item) => (sources.educators.elsewhere ??= []).push(item) },
    });
    const selfHint = h("p", { className: "hint", id: "workshop-self-hint", hidden: true },
      "To log a workshop you taught, tick Educator on your own profile in People.");

    const location = searchPicker({
      kind: "locations", id: "workshop-location", label: { labelledBy: "workshop-location-label" },
      source: sources.locations, input: { name: "location_id" }, onError,
    });
    const showLocationButton = addButton("workshop-location-show", "Add location", showLocation);
    const locationRow = h("div", { className: "picker-row", hidden: true },
      location.element,
      h("button", { type: "button", id: "workshop-location-remove", "aria-label": "Remove location", onclick: removeLocation }, "✕"));
    const deletedLocationRow = h("div", { className: "picker-row kept-deleted", id: "workshop-location-deleted", hidden: true },
      h("span", { className: "deleted" }, "(location deleted)"),
      h("button", { type: "button", "aria-label": "Remove location", onclick: removeDeletedLocation }, "✕"));
    const tagList = h("div", { className: "tag-row", id: "workshop-tags" });
    const saveButton = h("button", { type: "submit", className: "primary", id: "workshop-save" }, "Save workshop");
    const photos = photoSection({ item: workshop ? { workshop_id: workshop.id } : null, idPrefix: "workshop" });
    const drawings = drawingSection({ item: workshop ? { workshop_id: workshop.id } : null, idPrefix: "workshop" });
    const poses = poseSection({ item: workshop ? { workshop_id: workshop.id } : null, idPrefix: "workshop", addPhoto: intoPhotos(photos) });
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
        h("div", { className: "date-field" }, h("label", { htmlFor: "workshop-end_date" }, "End date"), endInput)),
      h("div", { className: "row" },
        h("div", {},
          h("div", { className: "label-row" },
            h("label", { htmlFor: "workshop-location", id: "workshop-location-label" }, "Location"), showLocationButton),
          locationRow, deletedLocationRow),
        h("div", { className: "minutes-field" },
          h("label", { htmlFor: "workshop-attendee_count" }, "Attendees"),
          privateField(h("input", {
            id: "workshop-attendee_count", name: "attendee_count", type: "number", min: "0", max: "100000", inputMode: "numeric",
          })))),
      h("div", { className: "label-row" },
        h("label", {}, "Educators"), addButton("workshop-add-educator", "Add educator", () => educators.add())),
      educators.element,
      selfHint,
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
      photos.element,
      drawings.element,
      poses.element,
      h("div", { className: "label-row" }, h("label", {}, "Tags"), addButton("workshop-add-tags", "Edit tags", chooseTags)),
      tagList,
      saveButton,
      h("button", { type: "button", className: "dialog-cancel", onclick: () => dialog.close() }, "Cancel"),
      workshop ? h("button", { type: "button", className: "danger dialog-delete", id: "workshop-delete", onclick: confirmDelete }, "Delete workshop") : null,
      message
    );

    // As with the tie form, tapping outside doesn't close it (a stray tap
    // can't throw away a half-written workshop); Esc still does.
    const dialog = h("dialog", { className: "form-dialog", "aria-labelledby": "workshop-form-heading" },
      h("h2", { id: "workshop-form-heading" }, workshop ? "Edit workshop" : "Add a workshop"),
      form);
    dialog.addEventListener("close", () => {
      photos.close();
      drawings.close();
      poses.close();
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
        selfHint.hidden = !people.some((p) => p.is_self && !p.is_educator);
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
      location.pick(home);
      locationRow.hidden = false;
      showLocationButton.hidden = true;
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
      if (photos.busy || drawings.busy || poses.busy) {
        showMessage(message, `Wait for the ${photos.busy ? "photos" : drawings.busy ? "drawings" : "poses"} to finish, then save.`, true);
        return;
      }
      saveButton.disabled = true;
      showMessage(message, "Saving…");
      try {
        // The description, notes and album link are sealed here, on the device.
        const body = await sealOne("workshop", collect());
        if (savedId) await api(`/api/workshops/${encodeURIComponent(savedId)}`, { method: "PUT", body });
        else savedId = (await api("/api/workshops", { method: "POST", body })).id;
        saved = true;
        if (photos.waiting) {
          const problem = await photos.uploadPending({ workshop_id: /** @type {string} */ (savedId) });
          if (problem) {
            showMessage(message, `The workshop is saved, but a photo couldn't be uploaded: ${problem} Save again to try again.`, true);
            return;
          }
        }
        if (drawings.waiting) {
          const problem = await drawings.savePending({ workshop_id: /** @type {string} */ (savedId) });
          if (problem) {
            showMessage(message, `The workshop is saved, but a drawing couldn't be saved: ${problem} Save again to try again.`, true);
            return;
          }
        }
        if (poses.waiting) {
          const problem = await poses.savePending({ workshop_id: /** @type {string} */ (savedId) });
          if (problem) {
            showMessage(message, `The workshop is saved, but a pose couldn't be saved: ${problem} Save again to try again.`, true);
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

    if (workshop) fill(workshop);
    document.body.append(dialog);
    dialog.showModal();
    loadPickers();
  });
}
