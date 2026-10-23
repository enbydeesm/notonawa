// Dragging a grid's tiles into order (the Photos and Drawings sections), with
// a mouse, or (after holding still a moment, so a swipe still scrolls) a
// finger. The pure parts are in drag-order.js.

import { HOLD_MS, movedFar, slotAt } from "./drag-order.js";

/**
 * Makes the tiles in `grid` (`.photo-tile`) draggable. Dropped on another
 * tile, onDrop is told where it went from and to.
 * @param {HTMLElement} grid
 * @param {{ count: () => number, onDrop: (from: number, to: number) => void }} options count: how
 *   many tiles there are (fewer than 2 can't be dragged)
 * @returns {{ stop: () => void }} stop: ends any drag under way (when the section closes)
 */
export function tileDrag(grid, { count, onDrop }) {
  /** Stops the drag under way, if any (its listeners are on document). */
  let dragStop = new AbortController();
  /** When the last drag ended: the click that follows it isn't a tap. */
  let draggedAt = 0;

  grid.addEventListener("pointerdown", startDrag);
  // A drag ends with a click on the tile it started on: that's not a tap.
  grid.addEventListener("click", (event) => {
    if (performance.now() - draggedAt < 400) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  // Holding a finger on a tile would otherwise open the browser's menu.
  grid.addEventListener("contextmenu", (event) => event.preventDefault());
  // A mouse would otherwise drag the image itself out of the page.
  grid.addEventListener("dragstart", (event) => event.preventDefault());

  /**
   * A pointer down on a tile: a mouse drags once it moves DRAG_PX; a finger
   * once it has held still for HOLD_MS (moving sooner is a scroll).
   * @param {PointerEvent} event
   */
  function startDrag(event) {
    if (event.button !== 0 || count() < 2) return;
    const tile = /** @type {Element} */ (event.target).closest(".photo-tile");
    const tiles = [...grid.children];
    const from = tile ? tiles.indexOf(tile) : -1;
    if (from < 0) return;
    dragStop.abort();
    dragStop = new AbortController();
    const { signal } = dragStop;
    const start = { x: event.clientX, y: event.clientY };
    const byMouse = event.pointerType === "mouse";
    let dragging = false;
    let to = from;
    const hold = byMouse ? undefined : setTimeout(begin, HOLD_MS);
    signal.addEventListener("abort", () => {
      clearTimeout(hold);
      for (const t of tiles) t.classList.remove("dragging", "drop-target");
    });

    function begin() {
      dragging = true;
      tile?.classList.add("dragging");
    }

    document.addEventListener("pointermove", (move) => {
      const now = { x: move.clientX, y: move.clientY };
      if (!dragging) {
        if (!movedFar(start, now)) return;
        if (!byMouse) return dragStop.abort();
        begin();
      }
      move.preventDefault();
      to = slotAt(tiles.map((t) => t.getBoundingClientRect()), now);
      for (const [i, t] of tiles.entries()) t.classList.toggle("drop-target", i === to && i !== from);
    }, { signal });
    // Once a finger is dragging, the page mustn't scroll under it.
    document.addEventListener("touchmove", (move) => { if (dragging) move.preventDefault(); }, { passive: false, signal });
    document.addEventListener("pointerup", () => {
      dragStop.abort();
      if (!dragging) return;
      draggedAt = performance.now();
      if (to === from || to < 0) return;
      onDrop(from, to);
    }, { signal });
    document.addEventListener("pointercancel", () => dragStop.abort(), { signal });
  }

  return { stop: () => dragStop.abort() };
}
