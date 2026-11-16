// Wires up a page for people or locations: an add/edit form (on the
// page, or in a dialog) and a list with Edit / Archive / Delete (or Restore /
// Delete when showing archived), or, with actionsInDialog, those as icons on
// the dialog's heading row.

import { errorMessage } from "./api.js";
import { h, $, showMessage, opensOnTap } from "./dom.js";
import { listItems, saveItem, archiveItem, restoreItem, deleteItem } from "./store/index.js";
import { listTools } from "./list-tools.js";
import { orderList } from "./list-order.js";
import { dialogIcon, iconButton } from "./dialog-icons.js";
import { watchChanges, guardClose } from "./form-changes.js";

// What one of each resource is called. (Plans have a form of their own,
// plan-form.js.)
/** @type {Record<"people" | "locations", string>} */
const KINDS = { people: "person", locations: "location" };

/**
 * @typedef {Record<string, any> & { id: string, archived_at: string | null }} Item
 * @typedef {{ archive: true } | { delete: true } | null} DeleteChoice
 * @typedef {{
 *   resource: "people" | "locations",
 *   form: HTMLFormElement,
 *   list: HTMLElement,
 *   archivedToggle: HTMLInputElement,
 *   renderItem: (item: Item, items: Item[], edit: () => void) => any,
 *   confirmDelete: (item: Item) => Promise<DeleteChoice>,
 *   beforeFill?: (item: Item) => void,
 *   onEdit?: (item: Item | null) => void,
 *   canRemove?: (item: Item) => boolean,
 *   onLoad?: (items: Item[], archived: boolean) => void,
 *   searchable?: { noun: string, pinned?: (item: Item) => boolean, slot?: HTMLElement },
 *   prepare?: (data: Record<string, any>) => Record<string, any>,
 *   dialog?: HTMLDialogElement,
 *   actionsInDialog?: boolean,
 *   extraActions?: (item: Item) => HTMLElement[],
 *   changeState?: () => unknown,
 *   itemClass?: string,
 *   filter?: (items: Item[]) => Item[],
 *   signal?: AbortSignal,
 * }} ResourcePageConfig
 *
 * form: its named fields match the API's fields. Elements with data-add-only
 *   are hidden while editing. Needs a .message, a submit button and a
 *   [data-cancel-edit] button (in the dialog's heading row, with a dialog:
 *   its ✕).
 * signal: aborts when the view is left.
 * onEdit: runs whenever the form switches to editing an item, or back to
 *   adding one (null), after it's reset.
 * canRemove: false hides an item's Archive and Delete buttons (my own
 *   profile); the API refuses them too.
 * renderItem: draws an item's part of its row; edit opens it in the form.
 * searchable: puts a search box (by name) and sort buttons (A–Z, date
 *   added; newest first to start) above the list, or in slot. pinned items
 *   stay at the top (my own profile).
 * prepare: turns the form's fields into what's sent, before it's sealed;
 *   throws to refuse it.
 * confirmDelete: resolves to { delete: true } to delete, { archive: true }
 *   to archive instead, or null to cancel.
 * dialog: the form is in this dialog, with its heading: add() and Edit
 *   open it, and saving or [data-cancel-edit] closes it. Like the tie form,
 *   a tap outside doesn't close it; Esc does, asking first if anything's
 *   changed. Editing, its Save changes waits for a change (form-changes.js).
 * actionsInDialog: the rows have no buttons: tapping one anywhere opens it
 *   (and renderItem calls edit from the name, the button keyboards use);
 *   Delete and Archive (or Restore) are icons in the dialog's heading row
 *   instead, in its [data-item-actions] element, for the item being edited.
 * extraActions: more icon buttons for the item being edited, after Delete
 *   and Archive, with actionsInDialog (Share my profile).
 * changeState: what else counts as a change, beside the form's fields.
 * itemClass: the rows' class, in place of "item".
 * filter: what a page's own search finds; redraw() after it changes.
 */

/**
 * @param {ResourcePageConfig} config
 */
export function setupResourcePage(config) {
  const { resource, form, list, archivedToggle, renderItem, confirmDelete, dialog } = config;
  const message = $(".message", form);
  const submit = /** @type {HTMLButtonElement} */ ($('button[type="submit"]', form));
  const cancel = /** @type {HTMLButtonElement} */ ($("[data-cancel-edit]", dialog ?? form));
  const heading = $("h2", dialog ?? /** @type {HTMLElement} */ (form.closest(".card")));
  if (dialog) {
    cancel.replaceChildren(dialogIcon("close"));
    // A saved item's dialog opens on its heading (openForm).
    heading.tabIndex = -1;
  }
  const addLabel = submit.textContent;
  const addHeading = heading.textContent;
  // "Edit person" in a dialog, where the heading is all there is to say what it's for.
  const editHeading = dialog ? `Edit ${KINDS[resource]}` : "Edit";
  /** @type {string | null} */
  let editingId = null;
  /** @type {Item[]} */
  let items = [];
  const tools = config.searchable ? listTools({ noun: config.searchable.noun, onChange: draw }) : null;
  if (tools) {
    if (config.searchable?.slot) config.searchable.slot.append(tools.element);
    else list.before(tools.element);
  }
  const itemActions = config.actionsInDialog ? $("[data-item-actions]", dialog ?? form) : null;
  const changes = watchChanges({
    form, button: submit, editing: () => editingId !== null, signal: config.signal,
    extra: () => [config.changeState?.()],
  });
  const close = dialog ? guardClose(dialog, changes.changed) : null;

  /** @param {Item | null} item */
  function setEditing(item) {
    editingId = item ? item.id : null;
    heading.textContent = item ? editHeading : addHeading;
    submit.textContent = item ? "Save changes" : addLabel;
    // In a dialog, Cancel closes it, adding or editing.
    cancel.hidden = !item && !dialog;
    for (const el of form.querySelectorAll("[data-add-only]")) {
      /** @type {HTMLElement} */ (el).hidden = !!item;
    }
    form.reset();
    itemActions?.replaceChildren(...(item ? dialogActions(item) : []));
    config.onEdit?.(item);
    if (item) {
      config.beforeFill?.(item);
      for (const el of fields()) {
        if (!(el.name in item)) continue;
        if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = !!item[el.name];
        else el.value = item[el.name] ?? "";
      }
      if (!dialog) form.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    showMessage(message, "");
  }

  /**
   * Shows the form for an item (or a new one): in its dialog, if it has one.
   * @param {Item | null} item
   */
  function openForm(item) {
    setEditing(item);
    changes.reset();
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.scrollTop = 0;
      // A saved item opens on its heading, not a text box (which would
      // open the keyboard); a new one, on its name or title.
      (item ? heading : /** @type {HTMLElement} */ ($("[name=name], [name=title]", form))).focus();
    }
  }

  /** The form's named inputs, selects and textareas. */
  function fields() {
    return /** @type {(HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[]} */ (
      [...form.elements].filter((el) => /** @type {HTMLInputElement} */ (el).name)
    );
  }

  function formData() {
    /** @type {Record<string, string | boolean>} */
    const data = {};
    for (const el of fields()) {
      data[el.name] = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value;
    }
    return data;
  }

  /**
   * Runs an action, then reloads the list.
   * @param {() => Promise<unknown>} fn
   * @param {string} errorPrefix
   */
  async function act(fn, errorPrefix) {
    try {
      await fn();
      await load();
    } catch (err) {
      alert(`${errorPrefix}: ${errorMessage(err)}`);
    }
  }

  /** Done with an item from its dialog (archived, restored or deleted). */
  function closeDialog() {
    if (config.actionsInDialog && dialog?.open) dialog.close();
  }

  /** @param {Item} item */
  async function archive(item) {
    await act(() => archiveItem(resource, item.id), "Couldn't archive");
    closeDialog();
  }

  /** @param {Item} item */
  async function restore(item) {
    await act(() => restoreItem(resource, item.id), "Couldn't restore");
    closeDialog();
  }

  /** @param {Item} item */
  async function remove(item) {
    const choice = await confirmDelete(item);
    if (!choice) return;
    if ("archive" in choice) return archive(item);
    await act(() => deleteItem(resource, item.id), "Couldn't delete");
    closeDialog();
    if (editingId === item.id) setEditing(null);
  }

  /**
   * The dialog's Delete and Archive (or Restore) icons, then any others,
   * with actionsInDialog.
   * @param {Item} item
   */
  function dialogActions(item) {
    const extra = config.extraActions?.(item) ?? [];
    const removable = config.canRemove?.(item) ?? true;
    if (!removable) return extra;
    const noun = KINDS[resource];
    return [
      iconButton("delete", { label: `Delete ${noun}`, onclick: () => remove(item) }),
      item.archived_at
        ? iconButton("restore", { label: `Restore ${noun}`, onclick: () => restore(item) })
        : iconButton("archive", { label: `Archive ${noun}`, onclick: () => archive(item) }),
      ...extra,
    ];
  }

  /** @param {Item} item */
  function renderActions(item) {
    const removable = config.canRemove?.(item) ?? true;
    return h(
      "div",
      { className: "item-actions" },
      item.archived_at
        ? h("button", { type: "button", onclick: () => restore(item) }, "Restore")
        : [
            h("button", { type: "button", onclick: () => openForm(item) }, "Edit"),
            removable ? h("button", { type: "button", onclick: () => archive(item) }, "Archive") : null,
          ],
      removable ? h("button", { type: "button", className: "danger", onclick: () => remove(item) }, "Delete") : null
    );
  }

  async function load() {
    const archived = archivedToggle.checked;
    try {
      items = await listItems(resource, archived);
      config.onLoad?.(items, archived);
      draw();
    } catch (err) {
      list.replaceChildren(h("p", { className: "empty" }, "Couldn't load: " + errorMessage(err)));
    }
  }

  /** Draws the list: all of it, or what the search finds, in the chosen order. */
  function draw() {
    list.replaceChildren();
    if (items.length === 0) {
      list.append(h("p", { className: "empty" }, archivedToggle.checked ? "Nothing archived." : "Nothing here yet. Add one above."));
      return;
    }
    const ordered = tools
      ? orderList(items, tools.query(), tools.order(), config.searchable?.pinned) : items;
    const shown = config.filter ? config.filter(ordered) : ordered;
    if (shown.length === 0) list.append(h("p", { className: "empty" }, "No matches."));
    for (const item of shown) {
      const unreadable = item.unreadable?.length
        ? h("div", { className: "item-meta deleted" }, "(can't decrypt the notes)") : null;
      const row = h("div", { className: config.itemClass ?? "item" }, renderItem(item, items, () => openForm(item)), unreadable,
        config.actionsInDialog ? null : renderActions(item));
      list.append(config.actionsInDialog ? opensOnTap(row, () => openForm(item)) : row);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!changes.canSave()) return; // editing, with nothing changed
    changes.busy(true);
    showMessage(message, "Saving…");
    try {
      const data = config.prepare ? config.prepare(formData()) : formData();
      await saveItem(resource, editingId, data);
      if (dialog) {
        dialog.close();
      } else {
        setEditing(null);
        showMessage(message, "Saved.");
      }
      await load();
    } catch (err) {
      showMessage(message, "Couldn't save: " + errorMessage(err), true);
    } finally {
      changes.busy(false);
    }
  });
  cancel.addEventListener("click", () => (close ? close() : setEditing(null)));
  // Closed (saved, Cancel or Esc): it opens fresh next time.
  dialog?.addEventListener("close", () => {
    editingId = null;
  });
  archivedToggle.addEventListener("change", load);

  setEditing(null);
  load();
  return {
    reload: load,
    items: () => items,
    redraw: draw,
    /** Opens the dialog to add one. */
    add: () => openForm(null),
    /** The item the form is editing (null: adding one, or closed). */
    editing: () => editingId,
  };
}
