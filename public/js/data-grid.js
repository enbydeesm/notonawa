// A compact grid of my things in a list (Your data's Shared by me and
// Connections, Account's passkeys and devices): a table with a row of
// column labels, each row's details, and its actions as icon buttons in
// the last column (a pencil, an eye, a red trash can).

import { h } from "./dom.js";
import { iconButton } from "./dialog-icons.js";

/**
 * @typedef {{ icon: import("./dialog-icons.js").IconKind, label: string, onclick: () => void, className?: string }} GridAction
 *   label: what it does, for screen readers and the tooltip
 * @typedef {{ cells: (Node | string | null)[], actions: (GridAction | null)[], className?: string }} GridRow
 */

/**
 * @param {{ columns: string[], rows: GridRow[], className: string, label: string }} grid columns: the labels,
 *   the actions' column after them unlabelled; className: the table's; label: what it lists, for screen readers
 * @returns {HTMLTableElement}
 */
export function dataGrid({ columns, rows, className, label }) {
  return h("table", { className: `data-grid ${className}`, "aria-label": label },
    h("thead", {}, h("tr", {}, ...columns.map((c) => h("th", { scope: "col" }, c)),
      h("th", { scope: "col", className: "grid-actions" }, h("span", { className: "visually-hidden" }, "Actions")))),
    h("tbody", {}, ...rows.map((row) => h("tr", { className: row.className ?? "" },
      ...row.cells.map((c) => h("td", {}, c ?? "")),
      h("td", { className: "grid-actions" }, ...row.actions.filter((a) => a !== null).map((a) => {
        const button = iconButton(a.icon, { label: a.label, onclick: a.onclick });
        if (a.className) button.classList.add(...a.className.split(" "));
        return button;
      }))))));
}
