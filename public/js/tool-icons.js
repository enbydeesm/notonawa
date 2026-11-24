// Icons for the drawing pad's and the poser's buttons, drawn in
// currentColor as the visuals' icons are (visual-icons.js): undo and redo
// (an arrow curling back left or on right), download (an arrow down into
// a tray), a pencil (the poser's drawing), and the poser's own: a cube (the
// views), a picture with a plus (Add to visuals), a turning arrow (Facing),
// a cross (letting a rope go), an eraser (a block tipped on its corner), the chosen rope's Cinch, Slide and Add rope,
// the hardpoints (a ring hanging from a line, a bamboo with its nodes, a
// hashira post), a › and the Body and Arms positions' figures. Each button using one says what
// it does in its aria-label and title.
//
// The figures are outlines, as the poser's high-kicking icon is
// (/img/poser-icon.svg): each limb a thick line in currentColor with a
// thinner one in the button's own color on top (.tool-icon-under in
// app.css), so where limbs cross they read as one shape, and a limb drawn
// later sits in front.

const SVG = "http://www.w3.org/2000/svg";

/**
 * One part of an icon: a path's d, or a path with more to it.
 * @typedef {string | { d: string, dash?: string, fill?: boolean, under?: boolean, filled?: boolean, width?: number }} Part
 */

/**
 * @param {Part[]} parts the icon's lines, on a 24 × 24 grid
 * @param {{ viewBox?: string, width?: number }} [size] a wider icon's grid and width (its height stays 20)
 */
function icon(parts, { viewBox = "0 0 24 24", width = 20 } = {}) {
  const el = document.createElementNS(SVG, "svg");
  for (const [name, value] of Object.entries({
    viewBox, width: String(width), height: "20", fill: "none", stroke: "currentColor", "stroke-width": "2",
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "tool-icon",
  })) el.setAttribute(name, value);
  if (width !== 20) el.classList.add("tool-icon-wide");
  for (const part of parts) {
    const { d, dash, fill, under, filled, width: w } = typeof part === "string" ? { d: part } : part;
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    if (dash) path.setAttribute("stroke-dasharray", dash);
    if (fill) path.setAttribute("fill", "currentColor");
    if (w) path.setAttribute("stroke-width", String(w));
    if (under) path.setAttribute("class", filled ? "tool-icon-under filled" : "tool-icon-under");
    el.append(path);
  }
  return el;
}

/** A circle as a path. @param {number} cx @param {number} cy @param {number} r */
const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/**
 * A limb outlined: a thick line, and the button's color down its middle.
 * @param {string} d @returns {Part[]}
 */
const limb = (d) => [{ d, width: 3.8 }, { d, width: 1.3, under: true }];

/**
 * A head or a trunk outlined: filled with the button's color (hiding what's behind), then its edge.
 * @param {string} d @returns {Part[]}
 */
const solid = (d) => [{ d, width: 1.3, under: true, filled: true }, { d, width: 1.3 }];

/** A rounded rectangle as a path. @param {number} x @param {number} y @param {number} w @param {number} hgt @param {number} r */
const rounded = (x, y, w, hgt, r) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${hgt - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}` +
  `a${r} ${r} 0 0 1 ${-r} ${-r}v${-(hgt - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

/**
 * @typedef {"undo" | "redo" | "download" | "pencil" | "views" | "addVisual" | "facing" | "close" | "eraser" | "cinch" | "slide" | "addRope"
 *   | "ring" | "bamboo" | "hashira" | "chevron" | "bodyPosition" | "armsPosition" | "seen" | "seeThrough" | "trash"
 *   | "forward" | "backward" | "addBefore" | "addAfter"} ToolIcon
 */

/** @type {Record<ToolIcon, () => SVGSVGElement>} */
export const TOOL_ICONS = {
  // The arrowhead top left, its line curling round below and back.
  undo: () => icon(["M9 4L4 9l5 5", "M4 9h11a5 5 0 0 1 0 10h-4"]),
  redo: () => icon(["M15 4l5 5-5 5", "M20 9H9a5 5 0 0 0 0 10h4"]),
  download: () => icon(["M12 3v11", "M7.5 9.5L12 14l4.5-4.5", "M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"]),
  // As the visuals' drawing icon: a pencil pointing down to the left.
  pencil: () => icon(["M15.5 4.5l4 4L9 19H5v-4z", "M13.5 6.5l4 4"]),
  // A cube seen from a corner: the views of the figure.
  views: () => icon([
    "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
    "m3.3 7 8.7 5 8.7-5", "M12 22V12",
  ]),
  // A picture (a hill and a sun) with a plus at its top right.
  addVisual: () => icon([
    "M16 5h6", "M19 2v6", "M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5",
    "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21", circle(9, 9, 2),
  ]),
  // An arrow turning back round: which way the body faces.
  facing: () => icon(["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"]),
  close: () => icon(["M18 6 6 18", "m6 6 12 12"]),
  eraser: () => icon(["m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21", "M22 21H7", "m5 11 9 9"]),
  // Two lines coming down side by side, and the cinch across them.
  cinch: () => icon(["M5 3l4 7v11", "M19 3l-4 7v11", "M6.5 13h11"]),
  // A bamboo (its nodes) over an arrow both ways: wider than the rest, so
  // the bamboo overhangs the arrow, which stays the others' size.
  slide: () => icon([rounded(-3, 4, 30, 4.5, 2.25), "M5 4v4.5", "M12 4v4.5", "M19 4v4.5", "M4 16.5h16", "m7 13.5-3 3 3 3", "m17 13.5 3 3-3 3"],
    { viewBox: "-4 0 32 24", width: 27 }),
  // A rope with the dot on it, a new one (dashed) curving off the dot, and
  // a plus beside the new one.
  addRope: () => icon(["M15 3 5 21", { d: circle(10.6, 11, 2.2), fill: true }, { d: "M10.6 11Q16 14 19 21", dash: "2.4 2.6" },
    "M20.4 8.6v6", "M17.4 11.6h6"]),
  // The hardpoints, as the chip on the Rope tab and Scene's buttons show them.
  ring: () => icon(["M12 2v3.5", circle(12, 13, 7)]),
  bamboo: () => icon([rounded(2, 9.5, 20, 5, 2.5), "M8.5 9.5v5", "M15.5 9.5v5"]),
  hashira: () => icon([rounded(8.5, 2, 7, 20, 1.5), "M10.5 6v4", "M13.5 12v5"]),
  chevron: () => icon(["m9 6 6 6-6 6"]),
  // Standing on one leg, the other folded out to the side (a futomomo).
  bodyPosition: () => icon([
    ...limb("M10.6 14 10.3 22.3"), ...limb("M13.6 13.8 20 12.6"),
    ...solid(circle(11.6, 3.6, 2.1)), ...solid(rounded(8.4, 6.8, 6.6, 9, 2.6)),
    ...limb("M7.2 8.2 6.6 13.4"), ...limb("M16.2 8.2 16.9 13.4"), ...limb("M20 12.6 14.8 15.4"),
  ]),
  // The arms bent overhead, the hands behind the head (bunny ears).
  armsPosition: () => icon([
    ...limb("M9.4 11.2 6.2 4.4"), ...limb("M14.6 11.2 17.8 4.4"), ...limb("M6.2 4.4 10.8 6.6"), ...limb("M17.8 4.4 13.2 6.6"),
    ...solid(rounded(8.6, 10.2, 6.8, 11.6, 2.6)), ...solid(circle(12, 6.9, 2.2)),
  ]),
  // A chosen rope drawn solid (an open eye) or see-through (crossed out).
  seen: () => icon(["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", circle(12, 12, 3)]),
  seeThrough: () => icon(["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", circle(12, 12, 3), "M4 4l16 16"]),
  trash: () => icon(["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12", "M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"]),
  // A point's layer: two strands, the top one brought over (or sent under) the other.
  forward: () => icon(["M3 17h18", { d: "M3 11h18", width: 3 }, { d: "m12 3-3 3h6z", fill: true }]),
  backward: () => icon([{ d: "M3 7h18", width: 3 }, "M3 13h18", { d: "m12 21-3-3h6z", fill: true }]),
  // A point added before or after the chosen one: ‹ and ›, underlined so
  // they read the same way up whichever way the view's turned.
  addBefore: () => icon(["m14 5-6 6 6 6", "M6 21h12"]),
  addAfter: () => icon(["m10 5 6 6-6 6", "M6 21h12"]),
};
