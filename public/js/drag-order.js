// Dragging photos and drawings into order: the pure parts (where a drag
// starts, which slot the pointer is over, the new order), kept apart from
// the pointer handling in tile-drag.js so they can be tested without a
// browser.

/** How far (in CSS pixels) a pointer moves before it counts as a drag, not a tap. */
export const DRAG_PX = 8;
/** How long a finger holds still before it drags rather than scrolls. */
export const HOLD_MS = 350;

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ left: number, top: number, right: number, bottom: number }} Box */

/**
 * Whether a pointer has moved far enough from where it went down to count
 * as a drag (or, for a finger still waiting to hold, as a scroll).
 * @param {Point} start
 * @param {Point} now
 * @returns {boolean}
 */
export function movedFar(start, now) {
  return Math.hypot(now.x - start.x, now.y - start.y) >= DRAG_PX;
}

/**
 * The slot a point is over: the tile it's on, or else the one whose middle
 * is nearest (a pointer in the gaps, or past the last tile).
 * @param {Box[]} boxes the tiles' boxes, first to last
 * @param {Point} point
 * @returns {number} -1 if there are no tiles
 */
export function slotAt(boxes, { x, y }) {
  let best = -1;
  let bestDistance = Infinity;
  for (const [i, box] of boxes.entries()) {
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return i;
    const distance = Math.hypot(x - (box.left + box.right) / 2, y - (box.top + box.bottom) / 2);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * A copy of the list with one item taken out and put back at another
 * place (the ones between shift along to make room).
 * @template T
 * @param {T[]} list
 * @param {number} from
 * @param {number} to
 * @returns {T[]}
 */
export function moveItem(list, from, to) {
  const order = [...list];
  if (from < 0 || from >= order.length || to < 0 || to >= order.length) return order;
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  return order;
}
