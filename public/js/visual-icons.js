// Icons for the kinds of visual, drawn in currentColor like the nav's: a
// camera (photos), a play button (videos), a pencil (drawings) and a
// kneeling figure (poses). The "Add a visual from…" chooser and the
// Visuals section's color key use them.

const SVG = "http://www.w3.org/2000/svg";

/**
 * @param {string} tag
 * @param {Record<string, string | number>} attrs
 */
function svg(tag, attrs) {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
}

/**
 * A 24 × 24 icon, outlined (or filled, for the parts given a fill).
 * @param {SVGElement[]} parts
 */
function icon(parts) {
  const el = svg("svg", {
    viewBox: "0 0 24 24", width: 24, height: 24, fill: "none", stroke: "currentColor",
    "stroke-width": 1.75, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "visual-icon",
  });
  el.append(...parts);
  return el;
}

/** @typedef {"photo" | "video" | "drawing" | "pose"} IconKind */

/** @type {Record<IconKind, () => SVGElement>} */
export const ICONS = {
  photo: () => icon([
    svg("path", { d: "M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" }),
    svg("circle", { cx: 12, cy: 13, r: 3.5 }),
  ]),
  // Like ▶️: a rounded square with a triangle in it.
  video: () => icon([
    svg("rect", { x: 3.5, y: 3.5, width: 17, height: 17, rx: 3.5 }),
    svg("path", { d: "M10 8.5v7l6-3.5z", fill: "currentColor" }),
  ]),
  drawing: () => icon([
    svg("path", { d: "M15.5 4.5l4 4L9 19H5v-4z" }),
    svg("path", { d: "M13.5 6.5l4 4" }),
  ]),
  // Kneeling, sitting back, seen from the side: the head, the back, an arm
  // behind, the thigh forward and the shin along the floor.
  pose: () => icon([
    svg("circle", { cx: 11, cy: 4.5, r: 2.2 }),
    svg("path", { d: "M10.5 7.5c-.6 2.5-.6 5 .2 7.5" }),
    svg("path", { d: "M10.4 9.5c-1.8 1-2.6 2.6-2.4 4.5l2.4.8" }),
    svg("path", { d: "M10.7 15l5.3.5 1.5 4" }),
    svg("path", { d: "M17.5 19.5H8.5" }),
  ]),
};
