// The search box and sort buttons above the People and Locations lists.
// list-order.js does the filtering and sorting.

import { h, privateField } from "./dom.js";
import { DEFAULT_ORDER, nextOrder } from "./list-order.js";

/**
 * @typedef {import("./list-order.js").ListOrder} ListOrder
 * @typedef {import("./list-order.js").SortKey} SortKey
 */

const SVG = "http://www.w3.org/2000/svg";

/**
 * @param {string} tag
 * @param {Record<string, string | number>} attrs
 * @param {...(Node | string)} children
 */
function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  el.append(...children);
  return el;
}

/** "A" over "Z", for sorting by name. */
function nameIcon() {
  return svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false", class: "list-sort-icon" },
    svg("text", { x: 12, y: 10.5, class: "sort-letter" }, "A"),
    svg("text", { x: 12, y: 22, class: "sort-letter" }, "Z"));
}

/** A clock, for sorting by when each was added. */
function dateIcon() {
  return svg("svg", {
    viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false", class: "list-sort-icon",
    fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round",
  },
  svg("circle", { cx: 12, cy: 12, r: 8.5 }),
  svg("path", { d: "M12 7.5V12l3 2" }));
}

/**
 * @param {{ noun: string, onChange: (query: string, order: ListOrder) => void }} options
 *   noun: what's listed, for the labels ("people")
 *   onChange: runs as the search is typed and when the sort changes
 */
export function listTools({ noun, onChange }) {
  let order = DEFAULT_ORDER;
  const search = /** @type {HTMLInputElement} */ (privateField(h("input", {
    type: "search", className: "list-search", placeholder: `Search ${noun}`, "aria-label": `Search ${noun}`,
  })));
  /** @type {Record<SortKey, HTMLButtonElement>} */
  const buttons = {
    name: h("button", { type: "button", className: "sort-button", "data-sort": "name" }, nameIcon(), h("span", { className: "sort-dir", "aria-hidden": "true" })),
    created: h("button", { type: "button", className: "sort-button", "data-sort": "created" }, dateIcon(), h("span", { className: "sort-dir", "aria-hidden": "true" })),
  };

  function show() {
    for (const [key, button] of /** @type {[SortKey, HTMLButtonElement][]} */ (Object.entries(buttons))) {
      const active = order.sort === key;
      // The chosen one says how it's sorted (tapping flips it); the other
      // says what it sorts by.
      const label = !active
        ? (key === "name" ? "Sort by name" : "Sort by date added")
        : key === "name"
          ? (order.descending ? "Sorted Z to A" : "Sorted A to Z")
          : (order.descending ? "Sorted newest first" : "Sorted oldest first");
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-label", label);
      button.title = label;
      /** @type {HTMLElement} */ (button.querySelector(".sort-dir")).textContent = active ? (order.descending ? "↓" : "↑") : "";
    }
  }

  for (const [key, button] of /** @type {[SortKey, HTMLButtonElement][]} */ (Object.entries(buttons))) {
    button.addEventListener("click", () => {
      order = nextOrder(order, key);
      show();
      onChange(search.value, order);
    });
  }
  search.addEventListener("input", () => onChange(search.value, order));
  show();

  return {
    element: h("div", { className: "list-tools" }, search, h("div", { className: "sort-buttons", role: "group", "aria-label": "Sort" }, buttons.name, buttons.created)),
    query: () => search.value,
    order: () => order,
  };
}
