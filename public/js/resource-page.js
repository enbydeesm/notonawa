// Wires up a page for plans, people or locations: an add/edit form and a list
// with Edit / Archive / Delete (or Restore / Delete when showing archived).

import { api, errorMessage } from "./api.js";
import { h, $, showMessage } from "./dom.js";

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
 *   onLoad?: (items: Item[], archived: boolean) => void,
 * }} ResourcePageConfig
 *
 * form: its named fields match the API's fields. Elements with data-add-only
 *   are hidden while editing. Needs a .message, a submit button and a
 *   [data-cancel-edit] button.
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
    return h(
      "div",
      { className: "item-actions" },
      item.archived_at
        ? h("button", { type: "button", onclick: () => restore(item) }, "Restore")
        : [
            h("button", { type: "button", onclick: () => setEditing(item) }, "Edit"),
            h("button", { type: "button", onclick: () => archive(item) }, "Archive"),
          ],
      h("button", { type: "button", className: "danger", onclick: () => remove(item) }, "Delete")
    );
  }

  async function load() {
    const archived = archivedToggle.checked;
    try {
      items = await api(`/api/${resource}?archived=${archived}`);
      config.onLoad?.(items, archived);
      list.replaceChildren();
      if (items.length === 0) {
        list.append(h("p", { className: "empty" }, archived ? "Nothing archived." : "Nothing here yet. Add one above."));
        return;
      }
      for (const item of items) {
        list.append(h("div", { className: "item" }, renderItem(item, items), renderActions(item)));
      }
    } catch (err) {
      list.replaceChildren(h("p", { className: "empty" }, "Couldn't load: " + errorMessage(err)));
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    showMessage(message, "Saving…");
    try {
      if (editingId) {
        await api(`/api/${resource}/${editingId}`, { method: "PUT", body: formData() });
      } else {
        await api(`/api/${resource}`, { method: "POST", body: formData() });
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
  archivedToggle.addEventListener("change", load);

  setEditing(null);
  load();
  return { reload: load, items: () => items };
}
