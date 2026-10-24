// Icons for the kinds of visual, drawn in currentColor like the nav's: a
// camera (photos), a play button (videos), a pencil (drawings) and a
// figure high-kicking (poses). The "Add a visual from…" chooser and the
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
  // A high kick, traced from a silhouette: the kicking leg up to the left,
  // fists up by the face. Filled, as the nav's people are, since the limbs
  // are too thin at this size to stay open as an outline.
  pose: () => icon([
    svg("path", {
      d: "M3.7 1.3c.2-.1 .6-.2 .8-.2 .3 0 .5 .1 .8 .1 .3 0 .7 0 1 .1 .3 .1 .6 .2 .9 .4 .4 .1 .8 .3 1.2 .5 .5 .2" +
        " .9 .3 1.4 .6 .4 .2 .8 .4 1.2 .6 .3 .2 .7 .3 .9 .5 .3 .2 .5 .5 .7 .7 .2 .3 .4 .5 .5 .8 .2 .3 .3 .6 .4" +
        " 1 .2 .3 .3 .9 .4 1.1 .2 .1 .3-.3 .4-.5 .1-.1 .2-.2 .3-.4 0-.1 .1-.4 0-.5-.1-.1-.5 0-.6-.2-.1-.1-.1-.6" +
        "-.1-.9 0-.2-.1-.6 0-.7 .1-.2 .5-.1 .4-.2 0-.1-.4-.4-.5-.7-.1-.2-.2-.6-.2-.8 .1-.3 .2-.6 .3-.8 .2-.3 .4" +
        "-.4 .7-.5 .3-.1 .7-.1 1-.1 .2 .1 .5 .2 .8 .4 .2 .2 .2 .5 .4 .7 .1 .2 0 .5 .1 .6 .2 .2 .3 .3 .7 .4 .3" +
        " .1 .8 .2 1.2 .4 .3 .2 .6 .4 .8 .6 .2 .2 .3 .5 .4 .7 .1 .3 .3 .7 .2 1 0 .2-.1 .5-.2 .6-.2 .1-.5 0-.8" +
        " .2-.2 .1-.3 .4-.5 .7-.3 .3-.4 .7-.7 1.1-.2 .3-.6 .6-.8 1.1-.3 .4-.6 .9-.8 1.3-.3 .4-.5 .8-.7 1.3-.3" +
        " .5-.7 1.2-1 1.7-.2 .5-.3 .8-.4 1.2-.1 .5-.1 1.1-.1 1.7-.1 .5-.3 1-.5 1.6-.1 .5-.4 1.1-.6 1.6-.1 .5-.3" +
        " .9-.3 1.3 0 .4 .3 .8 .2 1.1-.1 .2-.5 .4-.7 .4-.2 0-.5 0-.6-.2-.1-.2-.1-.6 0-1 .1-.5 .3-1.1 .4-1.6 .1" +
        "-.6 .1-1.2 .2-1.9 .1-.7 .2-1.6 .2-2.2 .1-.6 .2-1 .3-1.4 .1-.5 .2-.6 .3-1.1 .1-.5 .2-1.3 .2-1.8 .1-.4" +
        " .2-.5 .1-.7 0-.2-.3-.4-.5-.6-.2-.2-.4-.4-.6-.8-.2-.4-.3-.9-.5-1.4-.2-.4-.4-1.1-.6-1.6-.2-.4-.3-.9-.5" +
        "-1.2-.2-.3-.4-.4-.7-.6-.3-.3-.8-.5-1.2-.7-.3-.3-.7-.6-1-.8-.4-.3-.7-.6-1-.7-.3-.1-.7 .1-.9 0-.3-.1-.3" +
        "-.3-.5-.4-.2-.1-.6-.2-.9-.3-.2-.1-.5-.2-.7-.3-.1-.1-.2-.2-.1-.3z",
      fill: "currentColor", "stroke-width": 0.9,
    }),
  ]),
};
