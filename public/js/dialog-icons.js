// The icon buttons at the top right of an edit dialog, on its heading's
// row: delete, archive (or restore), share and close, in that order from
// the left. Each is drawn in currentColor, like the nav's icons, and named
// for screen readers and the tooltip.

import { h } from "./dom.js";

const SVG = "http://www.w3.org/2000/svg";

/**
 * @typedef {"close" | "share" | "archive" | "restore" | "delete" | "rename" | "save"
 *   | "earlier" | "later" | "duplicate" | "copy" | "check" | "show" | "signout" | "addperson"} IconKind
 */

/** Each icon's shapes, on a 24 × 24 grid. */
const SHAPES = /** @type {Record<IconKind, [string, Record<string, string | number>][]>} */ ({
  close: [["path", { d: "M6 6l12 12M18 6L6 18" }]],
  // Three dots joined at a "<".
  share: [
    ["circle", { cx: 18, cy: 5, r: 2.5 }], ["circle", { cx: 6, cy: 12, r: 2.5 }], ["circle", { cx: 18, cy: 19, r: 2.5 }],
    ["path", { d: "M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6" }],
  ],
  // A packing box with an arrow down into it (out of it, to restore).
  archive: [
    ["rect", { x: 3, y: 4, width: 18, height: 4, rx: 1 }],
    ["path", { d: "M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M12 11v6M9 14l3 3 3-3" }],
  ],
  restore: [
    ["rect", { x: 3, y: 4, width: 18, height: 4, rx: 1 }],
    ["path", { d: "M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M12 17v-6M9 14l3-3 3 3" }],
  ],
  // A pencil.
  rename: [["path", { d: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4M13.5 6.5l4 4" }]],
  // A floppy disk: its shutter at the top, its label below.
  save: [
    ["path", { d: "M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" }],
    ["path", { d: "M7 3v5h8V3M7 21v-7h10v7" }],
  ],
  delete: [
    ["path", { d: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" }],
  ],
  // The visual viewer's row (visual-viewer.js): arrows to move it, two
  // squares to duplicate it, a box with an arrow out to copy it elsewhere,
  // and a tick to save its caption.
  earlier: [["path", { d: "M19 12H5M11 6l-6 6 6 6" }]],
  later: [["path", { d: "M5 12h14M13 6l6 6-6 6" }]],
  duplicate: [
    ["rect", { x: 8, y: 8, width: 12, height: 12, rx: 1.5 }],
    ["path", { d: "M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" }],
  ],
  copy: [["path", { d: "M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" }]],
  check: [["path", { d: "M5 12l5 5 9-10" }]],
  // The data grids' rows (data-grid.js): an eye (show a share's code), a
  // door with an arrow out (sign a device out), and a person with a +
  // (put a connection on one of my People).
  show: [["path", { d: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" }], ["circle", { cx: 12, cy: 12, r: 3 }]],
  signout: [["path", { d: "M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" }]],
  addperson: [["circle", { cx: 9, cy: 8, r: 4 }], ["path", { d: "M2 21v-1a7 7 0 0 1 12.5-4.3M19 14v6M16 17h6" }]],
});

/**
 * An icon, outlined in currentColor.
 * @param {IconKind} kind
 * @returns {SVGSVGElement}
 */
export function dialogIcon(kind) {
  const el = document.createElementNS(SVG, "svg");
  const attrs = {
    viewBox: "0 0 24 24", width: 24, height: 24, fill: "none", stroke: "currentColor",
    "stroke-width": 1.75, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true",
  };
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  for (const [tag, shape] of SHAPES[kind]) {
    const part = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(shape)) part.setAttribute(name, String(value));
    el.append(part);
  }
  return el;
}

/**
 * One of the heading row's icon buttons. Delete is drawn in the danger color.
 * @param {IconKind} kind
 * @param {{ label: string, onclick: () => void, id?: string }} options
 *   label: what it does, for screen readers and the tooltip
 * @returns {HTMLButtonElement}
 */
export function iconButton(kind, { label, onclick, id }) {
  return h("button", {
    type: "button", className: kind === "delete" ? "icon-button danger" : "icon-button",
    "aria-label": label, title: label, onclick, ...(id ? { id } : {}),
  }, dialogIcon(kind));
}

/**
 * A dialog's heading row: the heading, then its icon buttons at the right.
 * The heading can take focus (tabindex -1), so a saved item's dialog can
 * open on it rather than on a text box, which would open the keyboard.
 * @param {HTMLHeadingElement} heading
 * @param {(HTMLElement | null)[]} buttons
 * @returns {HTMLDivElement}
 */
export function dialogHeader(heading, buttons) {
  heading.tabIndex = -1;
  return h("div", { className: "dialog-header" }, heading, h("span", { className: "dialog-icons" }, buttons));
}
