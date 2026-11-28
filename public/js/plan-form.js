// The plan form, in a pop-up dialog of its own, like the tie and workshop
// forms: opened from the Plans view's + and its cards, and from anywhere
// else (the poser opened on its own makes a new plan over itself). Empty to
// add a plan, or filled in with one to edit it, with Delete, Archive (or
// Restore), Share and ✕ icons on its heading's row. A saved plan's form
// lists the ties it's on, folded away; tapping one opens it in the tie
// form, over this one.
//
// Ids start with "plan-": this dialog opens over views (People, Locations)
// whose own forms use ids like #title, and the tie form opens over it.

import { errorMessage } from "./api.js";
import { h, $, showMessage, privateField } from "./dom.js";
import { choose } from "./dialog.js";
import { capitalise } from "./format.js";
import { pickTags } from "./tag-picker.js";
import { TIE_TYPES } from "./ties-view.js";
import { ratingField, ratingHanks } from "./rope-rating.js";
import { WEB_LINK_PATTERN, webLinkOrNull } from "./links.js";
import { listItems, saveItem, archiveItem, restoreItem, deletePlan } from "./store/index.js";
import { visualSection } from "./visuals-ui.js";
import { openShareItem } from "./share-item-dialog.js";
import { dialogIcon, iconButton } from "./dialog-icons.js";
import { watchChanges, guardClose } from "./form-changes.js";
import { startEntry } from "./new-entry-start.js";
import { editTie } from "./tie-card.js";
import { PLAN_TYPE_NAMES, variationsOf } from "./plans-view.js";
import { workshopLink } from "./workshop-link.js";
import { plusIcon } from "./plus-icon.js";
import { labelWithOpenLink } from "./open-link.js";

/** @typedef {import("./plans-view.js").LinkedTie} LinkedTie */

/** @type {Promise<boolean> | null} */
let openDialog = null;

/**
 * Opens the form, empty to add a plan, or filled in with one (as the plans
 * list has it, opened) to edit it. Resolves true if anything changed that
 * a list of plans shows: it was saved, archived, restored or deleted, or
 * one of its linked ties was edited. Opening it again while it's open
 * returns the same promise.
 * @param {Record<string, any> | null} [plan]
 * @param {{ start?: import("./new-entry-start.js").EntryStart, fromWorkshop?: { workshop_id: string, workshop_title: string, title?: string } }} [options]
 *   start: a new plan made from the poser on its own, with its pose;
 *   fromWorkshop: a new plan started from a workshop, linked to it
 * @returns {Promise<boolean>}
 */
export function openPlanForm(plan = null, { start, fromWorkshop } = {}) {
  openDialog ??= showPlanForm(plan, start ?? null, fromWorkshop ?? null).finally(() => { openDialog = null; });
  return openDialog;
}

/**
 * @param {Record<string, any> | null} plan
 * @param {import("./new-entry-start.js").EntryStart | null} start
 * @param {{ workshop_id: string, workshop_title: string, title?: string } | null} fromWorkshop a new plan started
 *   from a workshop's "Ties and plans", linked to it
 * @returns {Promise<boolean>}
 */
function showPlanForm(plan, start, fromWorkshop) {
  return new Promise((resolve) => {
    let changed = false;
    // The plan's id once it's saved: a new plan whose visuals didn't all
    // save stays open, and saving again edits it rather than adding another.
    let savedId = plan?.id ?? null;
    /** @type {string[]} tag names; new ones are created when it's saved */
    let tags = [...(plan?.tags ?? [])];

    const message = h("p", { className: "message", id: "plan-message" });
    /** @param {string} text @param {boolean} [isError] */
    const say = (text, isError = false) => showMessage(message, text, isError);
    const workshop = workshopLink({ idPrefix: "plan", onError: (text) => say(text, true) });

    // Difficulty as rope hanks; its hidden input is the form's est_difficulty.
    const difficulty = ratingField({ name: "est_difficulty", labelledBy: "plan-est_difficulty-label" });
    const variationSelect = h("select", { id: "plan-variation_of", name: "variation_of" }, h("option", { value: "" }, "N/A"));
    const tagList = h("div", { className: "tag-row", id: "plan-tags" });
    const linkedCount = h("span", { className: "item-meta", id: "plan-linked-count" });
    const linkedList = h("ul", { className: "linked-ties", id: "plan-linked-ties", "aria-labelledby": "plan-linked-label" });
    const linked = h("details", { className: "fold", id: "plan-linked", hidden: true },
      h("summary", { id: "plan-linked-label" }, "Linked ties ", linkedCount),
      linkedList);
    // The plans that are variations of this one, under "Variations (n)",
    // folded, below the linked ties: titles only, most recently updated first.
    const variationsCount = h("span", { className: "item-meta", id: "plan-variations-count" });
    const variationsList = h("ul", { className: "linked-ties", id: "plan-variations-list", "aria-labelledby": "plan-variations-label" });
    const variations = h("details", { className: "fold", id: "plan-variations", hidden: true },
      h("summary", { id: "plan-variations-label" }, "Variations ", variationsCount),
      variationsList);
    const visuals = visualSection({ item: plan ? { plan_id: plan.id } : null, idPrefix: "plan" });
    // "Open Album", once a saved plan has one.
    const albumLabel = labelWithOpenLink({ htmlFor: "plan-album_url", label: "Album link", link: "Open Album" });
    const saveButton = h("button", { type: "submit", className: "primary", id: "plan-save" }, plan ? "Save changes" : "Add plan");

    const form = h("form", { id: "plan-form", onsubmit: save },
      h("label", { htmlFor: "plan-title" }, "Title"),
      privateField(h("input", { id: "plan-title", name: "title", required: true, placeholder: "e.g. Hip harness to futomomo" })),
      h("div", { className: "row" },
        h("div", {},
          // Type replaced Stage on the form (stage stays in the database).
          h("label", { htmlFor: "plan-plan_type" }, "Plan type"),
          h("select", { id: "plan-plan_type", name: "plan_type" },
            Object.entries(PLAN_TYPE_NAMES).map(([value, name]) => h("option", { value }, name)))),
        h("div", {},
          // Optional, unlike a tie's.
          h("label", { htmlFor: "plan-tie_type" }, "Tie type"),
          h("select", { id: "plan-tie_type", name: "tie_type" },
            h("option", { value: "" }, "–"), TIE_TYPES.map((t) => h("option", { value: t }, capitalise(t)))))),
      h("div", { className: "row" },
        h("div", {},
          h("label", { id: "plan-est_difficulty-label" }, "Difficulty"),
          h("div", { id: "plan-est_difficulty-picker" }, difficulty.element)),
        h("div", {},
          h("label", { htmlFor: "plan-variation_of" }, "Variation of"),
          variationSelect)),
      workshop.element,
      h("label", { htmlFor: "plan-description" }, "Description"),
      privateField(h("textarea", { id: "plan-description", name: "description", placeholder: "The sequence, step by step" })),
      h("label", { htmlFor: "plan-notes" }, "Notes"),
      privateField(h("textarea", { id: "plan-notes", name: "notes" })),
      // Encrypted like the notes, so the page checks it (links.js).
      albumLabel.element,
      privateField(h("input", {
        id: "plan-album_url", name: "album_url", type: "url", inputMode: "url", pattern: WEB_LINK_PATTERN,
        placeholder: "https://photos.app.goo.gl/…", title: "A web address, starting with https://",
      })),
      h("div", { "data-photos": "" }, visuals.element),
      h("div", { className: "label-row" },
        h("label", { id: "plan-tags-label" }, "Tags"),
        h("button", { type: "button", className: "label-add", id: "plan-add-tags", "aria-label": "Edit tags", title: "Edit tags", onclick: chooseTags }, plusIcon())),
      tagList,
      linked,
      variations,
      saveButton,
      message);

    // Unlike the confirmation dialogs, tapping outside doesn't close this
    // one, so a stray tap can't throw away a half-written plan. Esc and ✕
    // do, asking first if anything's changed.
    const heading = h("h2", { id: "plan-form-heading", tabIndex: -1 }, plan ? "Edit plan" : "Add a plan");
    // data-item-actions and data-cancel-edit, as the Plans dialog had, so
    // the walkthrough finds them the same way as People's and Locations'.
    const icons = h("span", { className: "dialog-icons", "data-item-actions": "" }, plan ? itemIcons(plan) : []);
    const closeButton = h("button", {
      type: "button", className: "icon-button", id: "plan-close", "aria-label": "Close", title: "Close",
      "data-cancel-edit": "", onclick: () => close(),
    }, dialogIcon("close"));
    const dialog = h("dialog", { className: "form-dialog", id: "plan-dialog", "aria-labelledby": "plan-form-heading" },
      h("div", { className: "dialog-header" }, heading, icons, closeButton),
      form);

    /** Set once a plan from the poser is filled in, at the end. @type {ReturnType<typeof startEntry> | null} */
    let fromPoser = null;
    // Editing, Save changes waits for a change: the fields, the tags and
    // any visuals waiting for a new plan to be saved.
    const changes = watchChanges({
      form, button: saveButton, editing: () => !!plan, ignore: visuals.element,
      extra: () => [tags, visuals.waiting],
      unsaved: () => !!fromPoser?.unsaved(),
    });
    const close = guardClose(dialog, changes.changed, () => fromPoser?.discard() ?? null);
    dialog.addEventListener("close", () => {
      visuals.close();
      dialog.remove();
      resolve(changed || visuals.touched);
    });

    /**
     * Delete, Archive (or Restore) and Share, for a saved plan.
     * @param {Record<string, any>} p
     */
    function itemIcons(p) {
      return [
        iconButton("delete", { id: "plan-delete", label: "Delete plan", onclick: () => remove(p) }),
        p.archived_at
          ? iconButton("restore", { id: "plan-restore", label: "Restore plan", onclick: () => act(p, "restore", "Couldn't restore") })
          : iconButton("archive", { id: "plan-archive", label: "Archive plan", onclick: () => act(p, "archive", "Couldn't archive") }),
        // As last saved: the share is a copy of the plan, not of what's typed.
        iconButton("share", { id: "plan-share", label: "Share plan", onclick: () => share(p) }),
      ];
    }

    function showTags() {
      tagList.replaceChildren(...tags.map((name) => h("span", { className: "tag outline" }, name)));
    }

    async function chooseTags() {
      const picked = await pickTags(tags, { noun: "plan" });
      if (picked === null) return;
      tags = picked;
      showTags();
    }

    /**
     * The ties a saved plan is on, newest first, under "Linked ties (n)",
     * folded until it's tapped: each title opens the tie, with its rating at
     * the end of the row. Hidden for a new plan, or one on no ties.
     * @param {LinkedTie[]} ties
     */
    function showLinkedTies(ties) {
      linked.hidden = ties.length === 0;
      linkedCount.textContent = `(${ties.length})`;
      linkedList.replaceChildren(...ties.map((tie) => h("li", { className: "linked-tie" },
        h("button", { type: "button", className: "link linked-tie-title", onclick: () => openTie(tie.id) },
          tie.title || "Untitled tie"),
        tie.success_rating != null ? ratingHanks(tie.success_rating, `Rating ${tie.success_rating}/5`) : null)));
    }

    /**
     * Opens a linked tie over this form. If it's saved or deleted, the
     * linked ties are loaded again (the plan may have been taken off it);
     * what's typed here stays.
     * @param {string} id
     */
    async function openTie(id) {
      try {
        if (!(await editTie(id))) return;
        changed = true;
        const fresh = (await listItems("plans", "all")).find((/** @type {any} */ p) => p.id === savedId);
        if (fresh && dialog.open) showLinkedTies(fresh.linked_ties ?? []);
      } catch (err) {
        say("Couldn't open the tie: " + errorMessage(err), true);
      }
    }

    /**
     * The plans that are variations of this one (archived ones marked), or
     * the section hidden when there are none.
     * @param {Record<string, any>[]} plans every plan, archived ones too
     */
    function showVariations(plans) {
      const shown = variationsOf(plans, savedId);
      variations.hidden = shown.length === 0;
      variationsCount.textContent = `(${shown.length})`;
      variationsList.replaceChildren(...shown.map((p) => h("li", { className: "linked-tie" },
        h("span", { className: "linked-tie-title" }, p.title || "Untitled plan"),
        p.archived_at ? h("span", { className: "item-meta" }, "Archived") : null)));
    }

    /**
     * "Variation of" lists active plans, except this one; editing a
     * variation of an archived plan keeps that link rather than losing it.
     * The choice made (or the plan's) is kept. The same list gives this
     * plan's own variations.
     */
    async function loadVariations() {
      try {
        const all = await listItems("plans", "all");
        if (!dialog.open && !document.body.contains(dialog)) return;
        showVariations(all);
        const active = all.filter((/** @type {any} */ p) => !p.archived_at);
        const untouched = !changes.changed();
        const chosen = variationSelect.value || plan?.variation_of || "";
        variationSelect.replaceChildren(h("option", { value: "" }, "N/A"),
          ...active.filter((/** @type {any} */ p) => p.id !== savedId).map((/** @type {any} */ p) => h("option", { value: p.id }, p.title)));
        if (chosen && !active.some((/** @type {any} */ p) => p.id === chosen)) {
          variationSelect.append(h("option", { value: chosen }, "(archived plan)"));
        }
        variationSelect.value = chosen;
        // Filling it in isn't a change (unless something else was).
        if (untouched) changes.reset();
      } catch (err) {
        say("Couldn't load the plans: " + errorMessage(err), true);
      }
    }

    /** @param {Record<string, any>} p */
    function fill(p) {
      for (const el of fields()) {
        if (el.name in p && el.name !== "variation_of") el.value = p[el.name] ?? "";
      }
      albumLabel.show(p.album_url);
      difficulty.set(p.est_difficulty ?? null);
      workshop.set(p.workshop_id ?? null, p.workshop_title);
      showLinkedTies(p.linked_ties ?? []);
    }

    /** The form's named fields. */
    function fields() {
      return /** @type {(HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[]} */ (
        [...form.elements].filter((el) => /** @type {HTMLInputElement} */ (el).name));
    }

    function collect() {
      /** @type {Record<string, any>} */
      const data = Object.fromEntries(fields().map((el) => [el.name, el.value]));
      // The album link is sealed before it's sent, so the server can't check it.
      return { ...data, tags, album_url: webLinkOrNull(data.album_url) };
    }

    /** @param {SubmitEvent} event */
    async function save(event) {
      event.preventDefault();
      if (!changes.canSave()) return; // editing, with nothing changed
      if (visuals.busy) {
        say("Wait for the visuals to finish, then save.", true);
        return;
      }
      changes.busy(true);
      say("Saving…");
      try {
        savedId = await saveItem("plans", savedId, collect());
        changed = true;
        if (visuals.waiting) {
          const problem = await visuals.savePending({ plan_id: /** @type {string} */ (savedId) });
          if (problem) {
            heading.textContent = "Edit plan";
            saveButton.textContent = "Save changes";
            say(`Saved, but a visual couldn't be saved: ${problem} Save again to try again.`, true);
            return;
          }
        }
        fromPoser?.saved(/** @type {string} */ (savedId));
        dialog.close();
      } catch (err) {
        say("Couldn't save: " + errorMessage(err), true);
      } finally {
        changes.busy(false);
      }
    }

    /**
     * Archives or restores it, then closes.
     * @param {Record<string, any>} p
     * @param {"archive" | "restore"} action
     * @param {string} errorPrefix
     */
    async function act(p, action, errorPrefix) {
      try {
        await (action === "archive" ? archiveItem : restoreItem)("plans", p.id);
        changed = true;
        dialog.close();
      } catch (err) {
        say(`${errorPrefix}: ${errorMessage(err)}`, true);
      }
    }

    /**
     * Deletes it, after asking what its linked ties should do.
     * @param {Record<string, any>} p
     */
    async function remove(p) {
      const choice = await choose({
        title: `Delete "${p.title}"?`,
        message: "This can't be undone. Should ties that used this plan drop it too, " +
          `or keep a "(plan deleted)" note?`,
        choices: [
          { label: "Remove from linked ties too", value: "remove", style: "danger" },
          { label: "Just delete the plan", value: "keep", style: "danger" },
        ],
      });
      if (!choice) return;
      try {
        await deletePlan(p.id, /** @type {"remove" | "keep"} */ (choice));
        changed = true;
        dialog.close();
      } catch (err) {
        say("Couldn't delete: " + errorMessage(err), true);
      }
    }

    /** @param {Record<string, any>} p */
    async function share(p) {
      say("");
      try {
        await openShareItem("plan", p);
      } catch (err) {
        say("Couldn't share it: " + errorMessage(err), true);
      }
    }

    if (plan) fill(plan);
    else if (fromWorkshop) {
      workshop.set(fromWorkshop.workshop_id, fromWorkshop.workshop_title);
      /** @type {HTMLInputElement} */ ($("#plan-title", form)).value = fromWorkshop.title ?? "";
    }
    showTags();
    changes.reset();
    if (!plan && start) {
      fromPoser = startEntry({ start, kind: "plan", form, visuals, titleInput: /** @type {HTMLInputElement} */ ($("#plan-title", form)) });
    }
    document.body.append(dialog);
    dialog.showModal();
    dialog.scrollTop = 0;
    // A saved plan opens on its heading, not a text box (which would open
    // the keyboard); a new one, on its title.
    (plan ? heading : /** @type {HTMLElement} */ ($("#plan-title", form))).focus();
    loadVariations();
  });
}
