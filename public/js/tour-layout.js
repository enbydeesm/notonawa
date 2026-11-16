// Where the welcome tour's ring and pointer go (tour.js draws them as SVG,
// so nothing needs a style attribute, which the CSP refuses). Pure: rects
// in, numbers out, in the page's CSS pixels.

/** @typedef {{ left: number, top: number, width: number, height: number }} Box */

/** How far the ring stands off what it points at. */
export const RING_GAP = 5;
/** The pointer's half width, and how far it stays from the card's corners. */
export const POINTER_HALF = 9;
export const POINTER_INSET = 22;

/**
 * The ring round a target: the target grown by the gap on every side,
 * kept on screen. Null when the target takes no room (hidden, or not there).
 * @param {Box | null} target
 * @param {{ width: number, height: number }} view
 * @param {number} [gap]
 * @returns {Box | null}
 */
export function ringFor(target, view, gap = RING_GAP) {
  if (!target || target.width <= 0 || target.height <= 0) return null;
  const left = Math.max(0, target.left - gap);
  const top = Math.max(0, target.top - gap);
  const right = Math.min(view.width, target.left + target.width + gap);
  const bottom = Math.min(view.height, target.top + target.height + gap);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Which edge of the nav a stop's card lines up with: the left for an icon
 * in the left half of the window, else the right. The nav is centred, so
 * on a wide window (its 640px column) the card's pointer can always reach
 * its icon; on a phone the card is the nav's width either way.
 * @param {Box} ring
 * @param {number} viewWidth
 * @returns {"start" | "end"}
 */
export function sideFor(ring, viewWidth) {
  return ring.left + ring.width / 2 < viewWidth / 2 ? "start" : "end";
}

/**
 * Where the pointer's tip goes along the card's top edge: under the
 * middle of what it points at, but never past the card's rounded corners.
 * @param {Box} ring
 * @param {{ left: number, width: number }} card
 * @param {number} [inset]
 * @returns {number}
 */
export function pointerX(ring, card, inset = POINTER_INSET) {
  const middle = ring.left + ring.width / 2;
  const low = card.left + inset;
  const high = card.left + card.width - inset;
  if (high < low) return card.left + card.width / 2;
  return Math.min(high, Math.max(low, middle));
}

/**
 * The pointer as SVG points: a triangle whose tip is just under the ring
 * and whose base sits a pixel inside the card's top edge, covering its
 * border there. Two strings: the filled triangle, and its two upper sides
 * (the base isn't outlined, so it joins the card).
 * @param {number} x where the tip goes (pointerX)
 * @param {number} cardTop the card's top edge
 * @param {number} [half]
 * @returns {{ fill: string, edge: string }}
 */
export function pointerPoints(x, cardTop, half = POINTER_HALF) {
  const tip = cardTop - half;
  const base = cardTop + 1;
  const p = (/** @type {number} */ a, /** @type {number} */ b) => `${round(a)},${round(b)}`;
  return {
    fill: [p(x - half, base), p(x, tip), p(x + half, base)].join(" "),
    edge: [p(x - half, cardTop), p(x, tip), p(x + half, cardTop)].join(" "),
  };
}

/** @param {number} n */
function round(n) {
  return Math.round(n * 10) / 10;
}
