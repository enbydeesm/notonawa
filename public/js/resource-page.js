// Wires up a page for plans, people or locations: an add/edit form and a list
// with Edit / Archive / Delete (or Restore / Delete when showing archived).

import { api, errorMessage } from "./api.js";
import { h, $, showMessage } from "./dom.js";
import { open, sealOne, forgetSearch } from "./vault.js";
import { photoSection } from "./photos-ui.js";
import { listTools } from "./list-tools.js";
import { orderList } from "./list-order.js";

// Each resource's kind of record, for sealing and opening its notes (and a
// plan's description) in the crypto Worker.
/** @type {Record<"plans" | "people" | "locations", import("./crypto/fields.js").RecordKind>} */
const KINDS = { plans: "plan", people: "person", locations: "location" };

/**
 * @typedef {Record<string, any> & { id: string, archived_at: string | null }} Item
 * @typedef {{ archive: true } | { query: string } | null} DeleteChoice
 * @typedef {{
 *   resource: "plans" | "people" | "locations",
 *   form: HTMLFormElement,
 *   list: HTMLElement,
 *   archivedToggle: HTMLInputElement,
 *   renderItem: (item: Item, items: Item[]) => any,
 *   confirmDelete: (item: Item) => Promise<DeleteChoice>,
 *   beforeFill?: (item: Item) => void,
 *   onEdit?: (item: Item | null) => void,
 *   canRemove?: (item: Item) => boolean,
 *   onLoad?: (items: Item[], archived: boolean) => void,
 *   searchable?: { noun: string, pinned?: (item: Item) => boolean },
 *   signal?: AbortSignal,
 * }} ResourcePageConfig
 *
 * form: its named fields match the API's fields. Elements with data-add-only
 *   are hidden while editing. Needs a .message, a submit button and a
 *   [data-cancel-edit] button. A [data-photos] element (plans only) gets the
 *   Photos section; a new item's photos are uploaded once it's saved.
 * signal: aborts when the view is left (its photos are revoked then).
 * onEdit: runs whenever the form switches to editing an item, or back to
 *   adding one (null), after it's reset.
 * canRemove: false hides an item's Archive and Delete buttons (my own
 *   profile); the API refuses them too.
 * searchable: puts a search box (by name) and sort buttons (A–Z, date
 *   added; newest first to start) above the list. pinned items stay at the
 *   top (my own profile).
 * confirmDelete: resolves to { query } to delete (query is appended to the
 *   DELETE URL), { archive: true } to archive instead, or null to cancel.
 */

/**
 * @param {ResourcePageConfig} config
 */
export function setupResourcePage(config) {
  const { resource, form, list, archivedToggle, renderItem, confirmDelete } = config;
  const message = $(".message", form);
  const submit = /** @type {HTMLButtonElement} */ ($('button[type="submit"]', form));
  const cancel = /** @type {HTMLButtonElement} */ ($("[data-cancel-edit]", form));
  const heading = $("h2", /** @type {HTMLElement} */ (form.closest(".card")));
  const addLabel = submit.textContent;
  const addHeading = heading.textContent;
  /** @type {string | null} */
  let editingId = null;
  /** @type {Item[]} */
  let items = [];
  const photoSlot = /** @type {HTMLElement | null} */ (form.querySelector("[data-photos]"));
  /** @type {ReturnType<typeof photoSection> | null} */
  let photos = null;
  const tools = config.searchable ? listTools({ noun: config.searchable.noun, onChange: draw }) : null;
  if (tools) list.before(tools.element);

  /**
   * A fresh Photos section for the item being edited (or a new one).
   * @param {string | null} id
   */
  function showPhotos(id) {
    if (!photoSlot) return;
    photos?.close();
    photos = photoSection({ item: id ? { plan_id: id } : null, idPrefix: "plan" });
    photoSlot.replaceChildren(photos.element);
  }

  /**
   * Shows the form as editing this id, keeping what's typed (a new item
   * that saved, but whose photos didn't all upload).
   * @param {string} id
   */
  function markEditing(id) {
    editingId = id;
    heading.textContent = "Edit";
    submit.textContent = "Save changes";
    cancel.hidden = false;
  }

  /** @param {Item | null} item */
  function setEditing(item) {
    editingId = item ? item.id : null;
    heading.textContent = item ? "Edit" : addHeading;
    submit.textContent = item ? "Save changes" : addLabel;
    cancel.hidden = !item;
    for (const el of form.querySelectorAll("[data-add-only]")) {
      /** @type {HTMLElement} */ (el).hidden = !!item;
    }
    form.reset();
    config.onEdit?.(item);
    showPhotos(item ? item.id : null);
    if (item) {
      config.beforeFill?.(item);
      for (const el of fields()) {
        if (!(el.name in item)) continue;
        if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = !!item[el.name];
        else el.value = item[el.name] ?? "";
      }
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    showMessage(message, "");
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
      // A plan's title is searched in, with the ties it's on.
      forgetSearch();
      await load();
    } catch (err) {
      alert(`${errorPrefix}: ${errorMessage(err)}`);
    }
  }

  /** @param {Item} item */
  function archive(item) {
    return act(() => api(`/api/${resource}/${item.id}/archive`, { method: "POST" }), "Couldn't archive");
  }

  /** @param {Item} item */
  function restore(item) {
    return act(() => api(`/api/${resource}/${item.id}/restore`, { method: "POST" }), "Couldn't restore");
  }

  /** @param {Item} item */
  async function remove(item) {
    const choice = await confirmDelete(item);
    if (!choice) return;
    if ("archive" in choice) return archive(item);
    await act(() => api(`/api/${resource}/${item.id}${choice.query}`, { method: "DELETE" }), "Couldn't delete");
    if (editingId === item.id) setEditing(null);
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
            h("button", { type: "button", onclick: () => setEditing(item) }, "Edit"),
            removable ? h("button", { type: "button", onclick: () => archive(item) }, "Archive") : null,
          ],
      removable ? h("button", { type: "button", className: "danger", onclick: () => remove(item) }, "Delete") : null
    );
  }

  async function load() {
    const archived = archivedToggle.checked;
    try {
      items = await open(KINDS[resource], await api(`/api/${resource}?archived=${archived}`));
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
    const shown = tools
      ? orderList(items, tools.query(), tools.order(), config.searchable?.pinned) : items;
    if (shown.length === 0) list.append(h("p", { className: "empty" }, "No matches."));
    for (const item of shown) {
      const unreadable = item.unreadable?.length
        ? h("div", { className: "item-meta deleted" }, "(can't decrypt the notes)") : null;
      list.append(h("div", { className: "item" }, renderItem(item, items), unreadable, renderActions(item)));
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (photos?.busy) {
      showMessage(message, "Wait for the photos to finish, then save.", true);
      return;
    }
    submit.disabled = true;
    showMessage(message, "Saving…");
    try {
      // Notes are sealed here, on the device, before they're sent.
      const body = await sealOne(KINDS[resource], formData());
      let id = editingId;
      if (id) {
        await api(`/api/${resource}/${id}`, { method: "PUT", body });
      } else {
        id = /** @type {string} */ ((await api(`/api/${resource}`, { method: "POST", body })).id);
      }
      forgetSearch();
      if (photos?.waiting) {
        const problem = await photos.uploadPending({ plan_id: id });
        if (problem) {
          markEditing(id);
          showMessage(message, `Saved, but a photo couldn't be uploaded: ${problem} Save again to try again.`, true);
          await load();
          return;
        }
      }
      setEditing(null);
      showMessage(message, "Saved.");
      await load();
    } catch (err) {
      showMessage(message, "Couldn't save: " + errorMessage(err), true);
    } finally {
      submit.disabled = false;
    }
  });
  cancel.addEventListener("click", () => setEditing(null));
  config.signal?.addEventListener("abort", () => photos?.close());
  archivedToggle.addEventListener("change", load);

  setEditing(null);
  load();
  return { reload: load, items: () => items };
}
