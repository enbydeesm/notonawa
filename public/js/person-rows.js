// A form's list of people, each a search box and a role: the tie form's
// People, and a workshop's Educators and Participants. Editing, a row for
// someone since deleted shows "(person deleted)" and can be removed but not
// changed (kept() lists the ones left, for keep_deleted).

import { h, $ } from "./dom.js";
import { participantLabel } from "./ties-view.js";
import { roleName, roleOptions } from "./roles.js";
import { searchPicker } from "./search-picker.js";

/** @typedef {import("./search-choices.js").PickerSource} PickerSource */
/** @typedef {import("./search-choices.js").PickerItem} PickerItem */

// Every row's search box gets an id of its own, across all the lists.
let rowCount = 0;

/**
 * @param {{
 *   id: string,
 *   idPrefix: string,
 *   source: PickerSource,
 *   onError: (text: string) => void,
 *   startWithMe?: boolean,
 *   exclude?: () => Set<string>,
 *   picker?: Partial<Parameters<typeof searchPicker>[0]>,
 * }} config
 *   id: the list's element id; idPrefix: the start of its search boxes'
 *   ids; source: the people offered; startWithMe: the first row added
 *   starts with me in it (a new tie); exclude: ids chosen elsewhere, not
 *   offered (a row's own person is always offered); picker: more of
 *   searchPicker's options (newFields, onAdd, elsewhereNote).
 */
export function personRows({ id, idPrefix, source, onError, startWithMe = false, exclude, picker = {} }) {
  const element = h("div", { id });
  let addedPerson = !startWithMe;

  /** @param {HTMLElement} row */
  const removeButton = (row) => h("button", { type: "button", "aria-label": "Remove", onclick: () => row.remove() }, "✕");

  /**
   * Adds a row, empty or with one of the item's people in it.
   * @param {any} [existing] as the API lists them: { id, person_id, person_name, role }
   */
  function add(existing) {
    if (existing && !existing.person_id) {
      const { name, role } = participantLabel(existing);
      const row = h("div", { className: "picker-row kept-deleted", "data-link-id": existing.id },
        h("span", {}, h("span", { className: "deleted" }, name.text), ` (${roleName(role)})`));
      row.append(removeButton(row));
      element.append(row);
      return;
    }
    const row = h("div", { className: "picker-row person-row" });
    const role = h("select", { className: "role", "aria-label": "Role" },
      h("option", { value: "" }, "Choose Role"),
      roleOptions().map((r) => h("option", { value: r.value }, r.label)));
    const person = searchPicker({
      ...picker,
      kind: "people", id: `${idPrefix}-${++rowCount}`, label: { text: "Person" },
      source, input: { className: "person" }, onError,
      exclude: exclude && (() => {
        const skip = exclude();
        skip.delete(hidden.value);
        return skip;
      }),
      // Picking someone sets their usual role (or none), replacing any
      // role chosen for whoever was there before. It can still be changed.
      onPick: (item) => { role.value = item.defaultRole ?? ""; },
    });
    const hidden = /** @type {HTMLInputElement} */ ($(".person", person.element));
    row.append(person.element, role, removeButton(row));
    element.append(row);

    if (existing) {
      person.pick({ id: existing.person_id, name: existing.person_name, created_at: "" });
      role.value = existing.role; // after pick, which sets their usual role
      return;
    }
    const me = source.active.find((item) => item.isSelf);
    if (!addedPerson && me) {
      person.pick(me);
      role.focus();
    } else {
      person.focus();
    }
    addedPerson = true;
  }

  /**
   * The people chosen, as the API takes them. Empty rows are skipped; a
   * half-filled one is an error.
   * @returns {{ person_id: string, role: string }[]}
   */
  function collect() {
    const result = [];
    for (const row of element.querySelectorAll(".person-row")) {
      const personId = /** @type {HTMLInputElement} */ ($(".person", row)).value;
      const role = /** @type {HTMLSelectElement} */ ($(".role", row)).value;
      if (!personId && !role) continue;
      if (!personId || !role) throw new Error("Choose a person and a role for each row, or remove it.");
      result.push({ person_id: personId, role });
    }
    return result;
  }

  /** The ids of the people chosen so far. */
  function chosenIds() {
    return [...element.querySelectorAll(".person")].map((input) => /** @type {HTMLInputElement} */ (input).value).filter(Boolean);
  }

  /** The link ids of the "(person deleted)" rows still there. */
  function kept() {
    return [...element.querySelectorAll(".kept-deleted")].map((row) => /** @type {string} */ (/** @type {HTMLElement} */ (row).dataset.linkId));
  }

  return { element, add, collect, chosenIds, kept };
}
