// The marks over the poser's view for the chosen rope: the ‹ and › where a
// point would be added before or after its chosen point (underlined, so
// they read the same way up however the view's turned), each dot's layer
// above 0, and a small × at the spot a cinch or an added rope starts from.
// The ‹ › and × are plain black, no taller than a medium rope looks there
// (`size`), but never under MIN_MARK so they can still be seen; a tap
// still reaches them from a finger's width away. An SVG laid over the
// view, as the pencil's marks are, in the view's own pixels; it takes no
// taps itself (the poser checks a tap against `markAt`).

import { besidePaths, crossPaths } from "./pose-beside-paths.js";

const SVG = "http://www.w3.org/2000/svg";
/** How near a mark a tap has to be to be on it (CSS px): a finger's width. */
const MARK_REACH = 20;

/** @typedef {{ side: -1 | 1, x: number, y: number, size: number }} BesideMark a mark, where it is and how tall (CSS px) */
/** @typedef {{ x: number, y: number, size: number }} SpotMark the × at the spot, where it is and how tall (CSS px) */
/** @typedef {{ x: number, y: number, layer: number }} LayerMark a dot's layer, where the dot is */

/** @param {string} name @param {Record<string, string | number>} attributes */
function el(name, attributes) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** The layer over the view. */
export function besideLayer() {
  const svg = el("svg", { class: "pose-beside", id: "pose-beside", "aria-hidden": "true" });
  /** @type {BesideMark[]} */
  let shown = [];

  /**
   * Shows these marks, at the view's size now.
   * @param {BesideMark[]} marks @param {LayerMark[]} layers @param {SpotMark | null} [spot]
   */
  function draw(marks, layers, spot = null) {
    shown = marks;
    const { width, height } = svg.getBoundingClientRect();
    if (width > 0 && height > 0) svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.replaceChildren(
      ...layers.map(({ x, y, layer }) => {
        const g = el("g", { class: "pose-layer-mark", transform: `translate(${x + 11} ${y - 11})` });
        g.append(el("circle", { r: 8 }));
        const text = el("text", { "text-anchor": "middle", "dominant-baseline": "central" });
        text.textContent = String(layer);
        g.append(text);
        return g;
      }),
      ...marks.map(({ side, x, y, size }) => mark(`pose-beside-mark`, `pose-beside-${side < 0 ? "before" : "after"}`, x, y, besidePaths(side, size))),
      ...(spot ? [mark("pose-spot-mark", "pose-spot", spot.x, spot.y, crossPaths(spot.size))] : []));
  }

  /**
   * @param {string} className @param {string} id @param {number} x @param {number} y
   * @param {{ paths: string[], width: number }} lines
   */
  function mark(className, id, x, y, { paths, width }) {
    const g = el("g", { class: className, id, transform: `translate(${x} ${y})`, "stroke-width": width });
    for (const d of paths) g.append(el("path", { d }));
    return g;
  }

  /**
   * The mark under a tap (CSS px from the view's corner), if any.
   * @param {number} x @param {number} y
   * @returns {-1 | 1 | 0} its side, or 0
   */
  function markAt(x, y) {
    let best = /** @type {-1 | 1 | 0} */ (0), nearest = MARK_REACH;
    for (const { side, x: mx, y: my } of shown) {
      const away = Math.hypot(mx - x, my - y);
      if (away < nearest) [best, nearest] = [side, away];
    }
    return best;
  }

  return { svg, draw, markAt };
}
