// The "Add a workshop" form, in a pop-up dialog opened from the Education
// view's + (and from a workshop's title, to edit or delete it). Educators
// are chosen from the people marked Educator on People; my own profile is
// offered there only once it's marked too, and a workshop with me as an
// educator is one I taught.

import { errorMessage } from "./api.js";
import { h, $, showMessage, privateField, removeX, infoTip } from "./dom.js";
import { choose } from "./dialog.js";
import { today } from "./format.js";
import { pickTags } from "./tag-picker.js";
import { searchPicker } from "./search-picker.js";
import { pickerSource } from "./search-choices.js";
import { personRows } from "./person-rows.js";
import { ratingPicker, ratingField } from "./rope-rating.js";
import { CURRENCIES, costText, readCost, lastCurrency } from "./currency.js";
import { amountLabel, tieFromWorkshop } from "./workshops-view.js";
import { chooseAddTarget, kindIcon } from "./add-to-picker.js";
import { openTieForm } from "./tie-form.js";
import { editTie } from "./tie-card.js";
import { openPlanForm } from "./plan-form.js";
import { formatDate } from "./format.js";
import { WEB_LINK_PATTERN, webLinkOrNull } from "./links.js";
import { open } from "./vault.js";
import { visualSection } from "./visuals-ui.js";
import { openShareItem } from "./share-item-dialog.js";
import { dialogHeader, iconButton } from "./dialog-icons.js";
import { watchChanges, guardClose } from "./form-changes.js";
import { startEntry } from "./new-entry-start.js";
import {
  recentOnTies, listItems, listWorkshops, getWorkshop, saveWorkshop, deleteWorkshop, linkToWorkshop,
} from "./store/index.js";

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
  const workshop = await getWorkshop(id);
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
    /** My "this is me" profile's id, once loaded. @type {string | null} */
    let selfId = null;
    /** The workshop as last saved (for a new tie's location and people). @type {Record<string, any> | null} */
    let current = workshop;
    /** Its linked ties and plans, as shown. @type {{ kind: "tie" | "plan", id: string, title: string | null, date: string | null }[]} */
    let linkedItems = [];
    let linkedShown = false;
    let linksChanged = false;
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
    // Shown from the start (a tie's is behind a +): most workshops have one.
    const locationRow = h("div", { className: "picker-row removable" },
      location.element,
      Object.assign(removeX("Remove location", removeLocation), { id: "workshop-location-remove" }));
    const deletedLocationRow = h("div", { className: "picker-row removable kept-deleted", id: "workshop-location-deleted", hidden: true },
      h("span", { className: "deleted" }, "(location deleted)"),
      removeX("Remove location", removeDeletedLocation));
    const tagList = h("div", { className: "tag-row", id: "workshop-tags" });
    // The ties and plans linked to it (migration 0030): each opens in its
    // form over this one; + links one, or starts a new one linked to it.
    const linkedList = h("div", { className: "linked-list", id: "workshop-linked", role: "list" });
    const linkedHint = h("p", { className: "hint", id: "workshop-linked-hint" });
    const addLinkedButton = addButton("workshop-add-linked", "Add a tie or plan", addLinked);
    const saveButton = h("button", { type: "submit", className: "primary", id: "workshop-save" }, workshop ? "Save changes" : "Save workshop");
    const visuals = visualSection({ item: workshop ? { workshop_id: workshop.id } : null, idPrefix: "workshop" });
    const startInput = privateField(h("input", {
      id: "workshop-start_date", name: "start_date", type: "date", value: today(), required: true,
      onchange: () => { endInput.min = startInput.value; },
    }));
    const endInput = privateField(h("input", { id: "workshop-end_date", name: "end_date", type: "date", min: today() }));
    // The cost: a currency and an amount, sealed together as one field
    // (currency.js). Its label says Earned on a workshop I teach.
    const currencySelect = h("select", { id: "workshop-cost_currency", name: "cost_currency", "aria-label": "Currency" },
      CURRENCIES.map((c) => h("option", { value: c.code, title: c.name }, c.code)));
    const costInput = privateField(h("input", {
      id: "workshop-cost_amount", name: "cost_amount", inputMode: "decimal", placeholder: "0.00", maxLength: 14,
    }));
    const costLabel = h("label", { htmlFor: "workshop-cost_amount", id: "workshop-cost-label" }, "Paid");
    // The ratings beyond "How was it?", folded away; opened when editing
    // one that has any.
    const extraRatings = ["content", "teaching", "value"].map((key) => ({
      key, field: ratingField({ name: `rating_${key}`, labelledBy: `workshop-rating_${key}-label` }),
    }));
    const moreRatings = h("details", { className: "fold more-ratings", id: "workshop-more-ratings" },
      h("summary", {}, "More ratings"),
      extraRatings.map(({ key, field }) => h("div", { className: "label-row rating-row" },
        h("label", { id: `workshop-rating_${key}-label` }, key === "content" ? "Content" : key === "teaching" ? "Teaching" : "Value"),
        field.element)));

    const form = h("form", { id: "workshop-form", onsubmit: save },
      h("label", { htmlFor: "workshop-title" }, "Title"),
      privateField(h("input", { id: "workshop-title", name: "title", required: true, maxLength: 200, placeholder: "e.g. Intro to floor work" })),
      // The dates and Size, as a tie's Date, Type and Mins.
      h("div", { className: "row same-height workshop-dates" },
        h("div", { className: "date-field" }, h("label", { htmlFor: "workshop-start_date" }, "Start date"), startInput),
        h("div", { className: "date-field" },
          h("label", { htmlFor: "workshop-end_date" }, "End date ", h("span", { className: "label-note" }, "(optional)")), endInput),
        h("div", { className: "minutes-field" },
          h("label", { htmlFor: "workshop-attendee_count", title: "How many attended" }, "Size"),
          privateField(h("input", {
            id: "workshop-attendee_count", name: "attendee_count", type: "number", min: "0", max: "100000", inputMode: "numeric",
            placeholder: "10", title: "How many attended",
          })))),
      h("label", { htmlFor: "workshop-location", id: "workshop-location-label" }, "Location"),
      locationRow, deletedLocationRow,
      h("div", { className: "label-row" },
        h("label", {}, "Educators"), addButton("workshop-add-educator", "Add educator", () => educators.add()),
        Object.assign(selfHint.button, { className: `${selfHint.button.className} apart` })),
      selfHint.text,
      educators.element,
      h("div", { className: "label-row" },
        h("label", {}, "People"), addButton("workshop-add-participant", "Add person", () => participants.add())),
      participants.element,
      // The event's page, and what it cost: Paid, or Earned on one I teach.
      // Both sealed (crypto/fields.js); the link is checked as the album's is.
      h("div", { className: "row" },
        h("div", {},
          h("label", { htmlFor: "workshop-event_url" }, "Event link"),
          privateField(h("input", {
            id: "workshop-event_url", name: "event_url", type: "url", inputMode: "url", pattern: WEB_LINK_PATTERN,
            placeholder: "https://…", title: "A web address, starting with https://",
          }))),
        h("div", { className: "cost-field" },
          costLabel,
          h("div", { className: "cost-box" }, currencySelect, costInput))),
      h("label", { htmlFor: "workshop-description" }, "Workshop description"),
      privateField(h("textarea", {
        id: "workshop-description", name: "description",
        placeholder: "How it was originally described by educator, or summary of what it covered",
      })),
      h("div", { className: "label-row rating-row" },
        h("label", { id: "workshop-rating-label" }, "How was it?"),
        ratingPicker({ name: "rating", labelledBy: "workshop-rating-label", value: workshop?.rating ?? null })),
      h("div", { className: "label-row rating-row" },
        h("label", { id: "workshop-difficulty-label" }, "Difficulty"),
        ratingPicker({ name: "difficulty", labelledBy: "workshop-difficulty-label", value: workshop?.difficulty ?? null })),
      moreRatings,
      h("label", { htmlFor: "workshop-notes" }, "Notes"),
      privateField(h("textarea", { id: "workshop-notes", name: "notes", placeholder: "Your takeaways, how it went" })),
      // Encrypted like the notes (crypto/fields.js).
      h("label", { htmlFor: "workshop-album_url" }, "Album link"),
      privateField(h("input", {
        id: "workshop-album_url", name: "album_url", type: "url", inputMode: "url", pattern: WEB_LINK_PATTERN,
        placeholder: "https://photos.app.goo.gl/…", title: "A web address, starting with https://",
      })),
      visuals.element,
      h("div", { className: "label-row" }, h("label", { id: "workshop-linked-label" }, "Ties and plans"), addLinkedButton),
      linkedHint,
      linkedList,
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
      resolve(saved || linksChanged || visuals.touched);
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

    // The box stays: clearing it is all removing does.
    function removeLocation() {
      location.clear();
      location.focus();
    }

    // "(location deleted)" gives way to the box.
    function removeDeletedLocation() {
      deletedLocationRow.hidden = true;
      locationRow.hidden = false;
      location.focus();
    }

    /** I'm one of the educators: what's paid is what I earned. */
    function showCostLabel() {
      costLabel.textContent = amountLabel(educators.chosenIds(), selfId);
    }

    /**
     * The ties and plans linked to it, as the API lists them: plans first.
     * @param {{ kind: "tie" | "plan", id: string, title: string | null, date: string | null }[]} linked
     */
    function showLinked(linked) {
      // A tie or plan linked or unlinked here: the list's counts change.
      const key = (/** @type {typeof linked} */ list) => list.map((item) => item.id).join(",");
      if (linkedShown && key(linked) !== key(linkedItems)) linksChanged = true;
      linkedShown = true;
      linkedItems = linked;
      linkedList.replaceChildren(...linked.map((item) => {
        const title = item.title || (item.date ? `Tie, ${formatDate(item.date)}` : "Untitled tie");
        return h("button", {
          type: "button", className: "linked-row", role: "listitem",
          "aria-label": `${item.kind === "tie" ? "Tie" : "Plan"}: ${title}`, onclick: () => openLinked(item),
        }, kindIcon(item.kind), h("span", { className: "item-title" }, title));
      }));
      // A new workshop has no id to link to yet.
      addLinkedButton.disabled = !savedId;
      linkedHint.textContent = savedId
        ? (linked.length ? "" : "None yet. Link a tie at the workshop, or a plan of something you learned there.")
        : "Save the workshop first, then link ties and plans to it.";
      linkedHint.hidden = !linkedHint.textContent;
    }

    /** Fetches the list again (after one's linked, added, edited or deleted). */
    async function reloadLinked() {
      if (!savedId) return;
      try {
        const fresh = await getWorkshop(savedId);
        current = fresh;
        showLinked(fresh.linked ?? []);
      } catch (err) {
        showMessage(message, "Couldn't load its ties and plans: " + errorMessage(err), true);
      }
    }

    /** @param {{ kind: "tie" | "plan", id: string }} item */
    async function openLinked(item) {
      showMessage(message, "");
      try {
        if (item.kind === "tie") {
          await editTie(item.id);
        } else {
          // As the Plans view opens one: from the list, opened on the device.
          const plans = await listItems("plans", "all");
          const found = plans.find((/** @type {any} */ p) => p.id === item.id);
          if (!found) throw new Error("It's no longer there.");
          const [plan] = await open("plan", [found]);
          await openPlanForm(plan);
        }
      } catch (err) {
        showMessage(message, "Couldn't open it: " + errorMessage(err), true);
      }
      await reloadLinked();
    }

    // + under Ties and plans: link one, or start a new one linked to it.
    async function addLinked() {
      if (!savedId || !current) return;
      const choice = await chooseAddTarget({ what: "link", linked: new Set(linkedItems.map((item) => item.id)) });
      if (!choice) return;
      showMessage(message, "");
      try {
        if ("target" in choice) {
          const { kind, id } = choice.target;
          const body = kind === "tie" ? { tie_id: id } : { plan_id: id };
          await linkToWorkshop(savedId, body);
        } else if (choice.create === "tie") {
          const w = /** @type {Parameters<typeof tieFromWorkshop>[0]} */ (current);
          await openTieForm(null, { fromWorkshop: { ...tieFromWorkshop(w, today()), title: choice.title } });
        } else {
          await openPlanForm(null, { fromWorkshop: { workshop_id: savedId, workshop_title: current.title, title: choice.title } });
        }
      } catch (err) {
        showMessage(message, "Couldn't link it: " + errorMessage(err), true);
      }
      await reloadLinked();
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
        const [people, locations, recentPeople, recentLocations, mine] = await Promise.all([
          listItems("people", "all"),
          listItems("locations", "all"),
          recentOnTies("people"),
          recentOnTies("locations"),
          // A new one's currency starts as the last one used (sealed, so
          // only the device can tell which).
          workshop ? Promise.resolve([]) : listWorkshops(),
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
        selfId = people.find((p) => p.is_self)?.id ?? null;
        showCostLabel();
        startAtDefaultLocation();
        startOnLastCurrency(mine);
      } catch (err) {
        showMessage(message, "Couldn't load people and locations: " + errorMessage(err), true);
      }
    }

    // A new workshop starts at my default location, as a new tie does.
    function startAtDefaultLocation() {
      if (workshop || savedId || /** @type {HTMLInputElement} */ ($("input[name=location_id]", locationRow)).value) return;
      const home = sources.locations.active.find((item) => item.isDefault);
      if (!home) return;
      // Where a new workshop starts, not a change (unless something else was).
      const untouched = !changes.changed();
      location.pick(home);
      if (untouched) changes.reset();
    }

    /** @param {Record<string, any>[]} mine my workshops, opened */
    function startOnLastCurrency(mine) {
      if (workshop || savedId || costInput.value) return;
      const untouched = !changes.changed();
      currencySelect.value = lastCurrency(mine);
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
      data.event_url = webLinkOrNull(data.event_url);
      data.cost = costText(data.cost_currency, data.cost_amount);
      delete data.cost_currency;
      delete data.cost_amount;
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
        await deleteWorkshop(workshop.id);
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
      set("workshop-event_url", w.event_url);
      const cost = readCost(w.cost);
      if (cost) {
        currencySelect.value = cost.currency;
        costInput.value = cost.amount;
      }
      for (const { key, field } of extraRatings) field.set(w[`rating_${key}`] ?? null);
      moreRatings.open = extraRatings.some(({ key }) => w[`rating_${key}`] != null);
      if (w.unreadable?.length) {
        showMessage(message, "This workshop's description, notes, links or cost can't be decrypted. Saving replaces them.", true);
      }
      if (w.location_id) {
        location.pick({ id: w.location_id, name: w.location_name, created_at: "" });
      } else if (w.location_deleted) {
        deletedLocationRow.hidden = false;
        locationRow.hidden = true;
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
        savedId = await saveWorkshop(savedId, collect());
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
    // One educator row to start, as nearly every workshop has one; left empty, it isn't saved.
    if (!educators.element.querySelector(".person-row")) educators.add();
    showLinked(workshop?.linked ?? []);
    // Cost or Earned, as the educators change: a pick fires "change"; a
    // removed row, only the observer.
    educators.element.addEventListener("change", showCostLabel);
    new MutationObserver(showCostLabel).observe(educators.element, { childList: true });
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
