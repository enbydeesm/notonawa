// A search box for choosing a location, person or plan in the tie and
// workshop forms.
// Tapped, it lists the ones most recently on a tie; typing searches them
// all. A name that isn't one of mine can be added from the bottom of the
// list ("Add to list", or "Add & archive" for a one-off); one I've archived
// gets a pointer to restoring it instead. The chosen id goes in a hidden
// input, so the form can read it with the rest.

import { errorMessage } from "./api.js";
import { h, privateField } from "./dom.js";
import { searchChoices, addOffer, choiceLabel } from "./search-choices.js";
import { saveItem } from "./store/index.js";

/**
 * @typedef {import("./search-choices.js").PickerItem} PickerItem
 * @typedef {import("./search-choices.js").PickerSource} PickerSource
 * @typedef {"locations" | "people" | "plans"} PickerKind
 */

/** What differs between the kinds: the API's name field and the words used. */
const KINDS = {
  locations: { field: "name", plural: "locations", page: "Locations", what: "a name" },
  people: { field: "name", plural: "people", page: "People", what: "a name" },
  plans: { field: "title", plural: "plans", page: "Plans", what: "a title" },
};

/**
 * @param {{
 *   kind: PickerKind,
 *   id: string,
 *   label: { labelledBy: string } | { text: string },
 *   source: PickerSource,
 *   input: Record<string, string>,
 *   exclude?: () => Set<string>,
 *   onPick?: (item: PickerItem) => void,
 *   onError: (text: string) => void,
 *   newFields?: Record<string, unknown>,
 *   onAdd?: (item: PickerItem, archived: boolean) => void,
 *   elsewhereNote?: (name: string) => string,
 *   canAdd?: boolean,
 *   emptyText?: string,
 * }} config
 *   id: the text box's id (list and option ids start with it); label: a
 *   visible label's id, or words for screen readers when there's none;
 *   source: the items, shared by every picker of this kind; input: props
 *   for the hidden input (its name or class); exclude: ids chosen
 *   elsewhere, to leave out of the list; onPick: runs when a different
 *   item is picked (or added); onError: shows a problem in the form's
 *   message; newFields: also saved on one added here (e.g. is_educator);
 *   onAdd: runs once one is added, e.g. to offer it in other pickers;
 *   elsewhereNote: what to say when the name typed is one of the source's
 *   `elsewhere`; canAdd: false for choosing only from the source (no "Add
 *   to list"; e.g. my connections, to send something to); emptyText: what
 *   the list says when the source has none.
 */
export function searchPicker({
  kind, id, label, source, input, exclude, onPick, onError, newFields, onAdd, elsewhereNote, canAdd = true, emptyText,
}) {
  const words = KINDS[kind];
  /** @type {PickerItem | null} */
  let chosen = null;
  // What the arrow keys move through: the listed items, then the add
  // buttons. pick() runs on Enter or a tap.
  /** @type {{ el: HTMLElement, pick: () => void }[]} */
  let items = [];
  let active = -1;

  const listId = `${id}-list`;
  const named = "labelledBy" in label ? { "aria-labelledby": label.labelledBy } : { "aria-label": label.text };
  const hidden = privateField(h("input", { type: "hidden", value: "", ...input }));
  const box = privateField(h("input", {
    id, type: "text", placeholder: canAdd ? "Search or add" : "Search", role: "combobox", ...named,
    "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": listId,
    onfocus: () => { box.select(); open(""); },
    onclick: () => { if (box.getAttribute("aria-expanded") === "false") open(""); },
    oninput: () => open(box.value),
    onkeydown, onblur,
  }));
  const list = h("ul", { id: listId, className: "combo-list", role: "listbox", ...named, hidden: true });

  /** @param {string} query */
  function open(query) {
    const skip = exclude?.() ?? new Set();
    const shown = searchChoices(source.active.filter((item) => !skip.has(item.id)), source.recent, query);
    const offer = canAdd ? addOffer(source.active, source.archived, query, source.elsewhere) : null;
    /** @param {PickerItem} item */
    const pickItem = (item) => () => { pick(item); close(); };

    items = shown.map((item, i) => ({
      el: h("li", {
        id: `${listId}-${i}`, role: "option", className: "combo-option", "aria-selected": "false",
        onmousedown: keepFocus, onclick: pickItem(item),
      }, choiceLabel(item, query)),
      pick: pickItem(item),
    }));
    const rows = items.map((item) => item.el);

    if (!shown.length && query.trim()) rows.push(note("No matches."));
    if (!shown.length && !query.trim()) {
      rows.push(note(emptyText ?? (canAdd ? `No ${words.plural} yet. Type ${words.what} to add one.` : `No ${words.plural} yet.`)));
    }
    if (offer && "archived" in offer) {
      rows.push(note(`"${offer.archived}" is archived. Restore it from the ${words.page} page to use it again.`));
    }
    if (offer && "elsewhere" in offer) {
      rows.push(note(elsewhereNote?.(offer.elsewhere) ?? `"${offer.elsewhere}" can't be chosen here.`));
    }
    if (offer && "add" in offer) {
      const actions = [["Add to list", false], ["Add & archive", true]].map(([text, archive], i) => {
        const pick = () => add(offer.add, /** @type {boolean} */ (archive));
        return {
          el: h("button", {
            type: "button", className: "outline", id: `${listId}-add-${i}`, tabIndex: -1,
            onmousedown: keepFocus, onclick: pick,
          }, text),
          pick,
        };
      });
      items.push(...actions);
      rows.push(h("li", { className: "combo-actions" }, actions.map((a) => a.el)));
    }

    list.replaceChildren(...rows);
    list.hidden = false;
    box.setAttribute("aria-expanded", "true");
    active = -1;
    box.removeAttribute("aria-activedescendant");
  }

  /** @param {PickerItem | null} item */
  function shownName(item) {
    return item ? item.label ?? item.name : "";
  }

  /** @param {string} text */
  function note(text) {
    return h("li", { className: "combo-empty" }, text);
  }

  // Tapping the list would otherwise blur the box (and close the list)
  // before the tap lands.
  /** @param {MouseEvent} e */
  function keepFocus(e) {
    e.preventDefault();
  }

  function close() {
    list.hidden = true;
    box.setAttribute("aria-expanded", "false");
    box.removeAttribute("aria-activedescendant");
  }

  /**
   * Chooses an item from the list (or a new one), telling onPick if it's a
   * different one.
   * @param {PickerItem} item
   */
  function pick(item) {
    const changed = item.id !== chosen?.id;
    choose(item);
    if (changed) onPick?.(item);
  }

  /** @param {PickerItem | null} item */
  function choose(item) {
    chosen = item;
    const value = item?.id ?? "";
    const changed = hidden.value !== value;
    hidden.value = value;
    box.value = shownName(item);
    // Code setting a value fires no event: this tells the form (whether it
    // has changes, form-changes.js), as a pick after adding one comes late.
    if (changed) hidden.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Nothing picked from the list: an empty box means none; anything else
  // goes back to the last choice, so the box never shows something that
  // won't be saved.
  function settle() {
    if (box.value.trim() === "") choose(null);
    else box.value = shownName(chosen);
  }

  /**
   * Saves the typed name as a new item and picks it. An archived one is
   * used on this tie but isn't offered in the lists.
   * @param {string} name
   * @param {boolean} archive
   */
  async function add(name, archive) {
    close();
    try {
      const body = { ...newFields, [words.field]: name, archive_now: archive };
      const newId = await saveItem(kind, null, body);
      const item = { id: newId, name, created_at: new Date().toISOString() };
      (archive ? source.archived : source.active).push(item);
      onAdd?.(item, archive);
      pick(item);
    } catch (err) {
      onError(`Couldn't add "${name}": ${errorMessage(err)}`);
    }
  }

  /** @param {number} index */
  function highlight(index) {
    active = index;
    items.forEach((item, i) => {
      item.el.classList.toggle("active", i === index);
      if (item.el.getAttribute("role") === "option") item.el.setAttribute("aria-selected", String(i === index));
    });
    box.setAttribute("aria-activedescendant", items[index].el.id);
    items[index].el.scrollIntoView({ block: "nearest" });
  }

  /** @param {KeyboardEvent} e */
  function onkeydown(e) {
    const isOpen = !list.hidden;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) open(chosen ? "" : box.value);
      if (!items.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      highlight((active + step + items.length) % items.length);
    } else if (e.key === "Enter" && isOpen) {
      // Enter picks from the list instead of saving the tie.
      e.preventDefault();
      if (active >= 0) items[active].pick();
      else { settle(); close(); }
    } else if (e.key === "Escape" && isOpen) {
      // Closes the list, not the whole tie form.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function onblur() {
    close();
    settle();
  }

  return {
    element: h("div", { className: "combo" }, box, list, hidden),
    focus: () => box.focus(),
    /** Picks an item without opening the list, as if it was tapped. */
    pick,
    /** Empties the box (e.g. when its row is removed). */
    clear: () => { choose(null); close(); },
  };
}
