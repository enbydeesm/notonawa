// Icons for the kinds of visual, drawn in currentColor like the nav's: a
// camera (photos), a play button (videos), a pencil (drawings) and a
// figure with a knee raised (poses, from /img/poser-icon-v2.svg). The "Add a visual
// from…" chooser and the Visuals section's color key use them.

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

/** @type {Record<IconKind, () => Element>} */
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
  // A high kick, from a file: app.css uses it as a mask over currentColor
  // (.pose-icon), so it takes the text or key color as the others do.
  pose: () => {
    const el = document.createElement("span");
    el.className = "visual-icon pose-icon";
    el.setAttribute("aria-hidden", "true");
    return el;
  },
};
