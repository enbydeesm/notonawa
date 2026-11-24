// The marks over the poser's view for the chosen rope's chosen point: the
// ‹ and › where a point would be added before or after it (underlined, so
// they read the same way up however the view's turned), and each dot's
// layer above 0. An SVG laid over the view, as the pencil's marks are, in
// the view's own pixels; it takes no taps itself (the poser checks a tap
// against `markAt`).

const SVG = "http://www.w3.org/2000/svg";
/** How near a mark a tap has to be to be on it (CSS px): a finger's width. */
const MARK_REACH = 20;

/** @typedef {{ side: -1 | 1, x: number, y: number }} BesideMark a mark, where it is (CSS px) */
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
   * @param {BesideMark[]} marks @param {LayerMark[]} layers
   */
  function draw(marks, layers) {
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
      ...marks.map(({ side, x, y }) => {
        const g = el("g", { class: "pose-beside-mark", id: `pose-beside-${side < 0 ? "before" : "after"}`, transform: `translate(${x} ${y})` });
        g.append(el("circle", { r: 13 }));
        g.append(el("path", { d: side < 0 ? "M2.5 -7 -3.5 -1 2.5 5" : "M-2.5 -7 3.5 -1 -2.5 5" }));
        g.append(el("path", { d: "M-6 8.5H6" }));
        return g;
      }));
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
