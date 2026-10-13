// A drop-down of checkboxes with a search box, for choosing several people or
// locations. Archived options show in muted text.

import { h, privateField } from "./dom.js";
import { sortByName, nameMatches } from "./tie-search.js";

/**
 * @typedef {{ id: string, name: string, archived: boolean }} Option
 * @typedef {{
 *   labelledBy: string,
 *   placeholder: string,
 *   searchLabel: string,
 *   onChange: (ids: string[]) => void,
 * }} MultiSelectConfig
 *
 * labelledBy: the id of the visible label above it.
 * placeholder: shown when nothing is chosen, e.g. "Anyone".
 */

/**
 * @param {MultiSelectConfig} config
 */
export function multiSelect({ labelledBy, placeholder, searchLabel, onChange }) {
  /** @type {Option[]} */
  let options = [];
  /** @type {Set<string>} */
  let selected = new Set();

  const summary = h("summary", { "aria-labelledby": labelledBy });
  const search = privateField(h("input", {
    type: "search", placeholder: searchLabel, "aria-label": searchLabel,
    oninput: renderOptions,
  }));
  const list = h("div", { className: "multi-select-options" });
  const details = h("details", { className: "multi-select" },
    summary, h("div", { className: "multi-select-panel" }, search, list));

  details.addEventListener("toggle", () => {
    if (details.open) search.focus();
  });
  details.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && details.open) {
      e.preventDefault();
      details.open = false;
      summary.focus();
    }
  });
  // Close when tapping anywhere else on the page.
  document.addEventListener("click", (e) => {
    if (details.open && !details.contains(/** @type {Node} */ (e.target))) details.open = false;
  });

  function renderSummary() {
    const names = options.filter((o) => selected.has(o.id)).map((o) => o.name);
    summary.textContent = names.length ? names.join(", ") : placeholder;
    summary.classList.toggle("placeholder", names.length === 0);
  }

  function renderOptions() {
    const shown = options.filter((o) => nameMatches(o.name, search.value));
    list.replaceChildren(
      ...shown.map((o) =>
        h("label", { className: o.archived ? "inline archived" : "inline" },
          h("input", {
            type: "checkbox", value: o.id, checked: selected.has(o.id),
            onchange: (/** @type {Event} */ e) => {
              const box = /** @type {HTMLInputElement} */ (e.target);
              if (box.checked) selected.add(o.id);
              else selected.delete(o.id);
              renderSummary();
              onChange([...selected]);
            },
          }),
          o.name))
    );
    if (shown.length === 0) {
      list.append(h("p", { className: "hint" }, options.length ? "No matches." : "Nothing to choose yet."));
    }
  }

  return {
    element: details,

    /**
     * Sets the choices, A–Z. Chosen ids that aren't among them (e.g. someone
     * deleted since the URL was saved) are dropped, and onChange is called.
     * @param {Option[]} newOptions
     */
    setOptions(newOptions) {
      options = sortByName(newOptions);
      const known = new Set(options.map((o) => o.id));
      const kept = [...selected].filter((id) => known.has(id));
      const dropped = kept.length !== selected.size;
      selected = new Set(kept);
      renderSummary();
      renderOptions();
      if (dropped) onChange(kept);
    },

    /** @param {string[]} ids */
    setSelected(ids) {
      selected = new Set(ids);
      renderSummary();
      renderOptions();
    },
  };
}
