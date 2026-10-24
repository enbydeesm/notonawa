// Icons for the drawing pad's and the poser's buttons, drawn in
// currentColor as the visuals' icons are (visual-icons.js): undo and redo
// (an arrow curling back left or on right) and download (an arrow down
// into a tray). Each button using one says what it does in its aria-label
// and title.

const SVG = "http://www.w3.org/2000/svg";

/** @param {string[]} paths the icon's lines, on a 24 × 24 grid */
function icon(paths) {
  const el = document.createElementNS(SVG, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "2",
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "tool-icon",
  })) el.setAttribute(name, value);
  for (const d of paths) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    el.append(path);
  }
  return el;
}

/** @typedef {"undo" | "redo" | "download"} ToolIcon */

/** @type {Record<ToolIcon, () => SVGSVGElement>} */
export const TOOL_ICONS = {
  // The arrowhead top left, its line curling round below and back.
  undo: () => icon(["M9 4L4 9l5 5", "M4 9h11a5 5 0 0 1 0 10h-4"]),
  redo: () => icon(["M15 4l5 5-5 5", "M20 9H9a5 5 0 0 0 0 10h4"]),
  download: () => icon(["M12 3v11", "M7.5 9.5L12 14l4.5-4.5", "M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"]),
};
