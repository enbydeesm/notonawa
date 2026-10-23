// Editing a drawing's lines: undo and redo, and which line the eraser
// touches. Pure, so it's easy to test; the drawing pad (drawing-editor.js)
// does the pointer handling.
//
// Each change makes a new list of lines (the lines themselves are never
// changed), so a history is just the lists before and after.

import { LINE_UNITS, segmentDistance } from "./drawing-format.js";

/** @typedef {import("./drawing-format.js").Stroke} Stroke */
/** @typedef {{ past: Stroke[][], strokes: Stroke[], future: Stroke[][] }} History */

/** How many changes undo can go back. */
export const MAX_UNDO = 200;

/**
 * @param {Stroke[]} strokes the drawing's lines to start from
 * @returns {History}
 */
export function startHistory(strokes) {
  return { past: [], strokes, future: [] };
}

/**
 * The history after a change: the old lines can be undone back to, and
 * anything undone before can't be redone any more.
 * @param {History} history
 * @param {Stroke[]} strokes the lines now
 * @returns {History}
 */
export function change(history, strokes) {
  return { past: [...history.past, history.strokes].slice(-MAX_UNDO), strokes, future: [] };
}

/**
 * @param {History} history
 * @returns {History} unchanged if there's nothing to undo
 */
export function undo(history) {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    strokes: history.past[history.past.length - 1],
    future: [history.strokes, ...history.future],
  };
}

/**
 * @param {History} history
 * @returns {History} unchanged if there's nothing to redo
 */
export function redo(history) {
  if (history.future.length === 0) return history;
  return {
    past: [...history.past, history.strokes],
    strokes: history.future[0],
    future: history.future.slice(1),
  };
}

/**
 * The line the eraser is on, the top one (drawn last) where lines cross:
 * within `reach` canvas units of its edge.
 * @param {Stroke[]} strokes
 * @param {[number, number]} point on the canvas
 * @param {number} reach
 * @returns {number} its index, or -1 for none
 */
export function strokeAt(strokes, [x, y], reach) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const { p, w } = strokes[i];
    const near = reach + LINE_UNITS[w] / 2;
    if (p.length === 2) {
      if (Math.hypot(x - p[0], y - p[1]) <= near) return i;
      continue;
    }
    for (let j = 0; j + 3 < p.length; j += 2) {
      if (segmentDistance(x, y, p[j], p[j + 1], p[j + 2], p[j + 3]) <= near) return i;
    }
  }
  return -1;
}
