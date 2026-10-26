// Marks drawn over the poser's view with its pencil: flat on the screen,
// not in the 3D scene, and never saved with the pose. They go into the
// pictures of it ("Add to visuals", download), and show only while the view
// is the one they were drawn on (turning it hides them). Pure, so it's
// tested.
//
// A mark's points are in view units: 1000 from the view's top to its
// bottom, and x from its middle, in the same units. The 3D view keeps its
// height in proportion and grows or shrinks at the sides (its field of view
// is up and down), so marks in these units stay on what they were drawn
// over when the view, or the picture, is another shape.

import { LINE_UNITS, simplify } from "./drawing-format.js";
import { strokeAt } from "./drawing-edit.js";

/** @typedef {import("./drawing-format.js").Stroke} Stroke */
/** @typedef {import("./pose-format.js").Camera} Camera */
/** @typedef {{ camera: Camera, strokes: Stroke[] }} Marks */

/** View units from the top of the view to its bottom. */
export const VIEW_HEIGHT = 1000;
/** A line's width in view units: a drawing's, as it shows on a 1200-high picture. */
export const MARK_UNITS = /** @type {const} */ ({ 1: LINE_UNITS[1] * 1000 / 1200, 2: LINE_UNITS[2] * 1000 / 1200, 3: LINE_UNITS[3] * 1000 / 1200 });
/** How far around the eraser (view units) a mark is caught. */
const ERASER_REACH = 12;

/**
 * A point on the view (CSS px from its corner) in view units.
 * @param {number} x @param {number} y
 * @param {{ width: number, height: number }} size the view's
 * @returns {[number, number]}
 */
export function toViewUnits(x, y, { width, height }) {
  const scale = VIEW_HEIGHT / height;
  return [Math.round((x - width / 2) * scale), Math.round(y * scale)];
}

/**
 * The view units' box on a view or picture this size, as an SVG viewBox
 * (x from the middle).
 * @param {{ width: number, height: number }} size
 */
export function viewBox({ width, height }) {
  const across = VIEW_HEIGHT * width / height;
  return `${-across / 2} 0 ${across} ${VIEW_HEIGHT}`;
}

/**
 * Marks as they go on a picture this size: points and widths in its pixels.
 * @param {Stroke[]} strokes
 * @param {{ width: number, height: number }} size
 * @returns {{ c: Stroke["c"], width: number, p: number[] }[]}
 */
export function onPicture(strokes, { width, height }) {
  const scale = height / VIEW_HEIGHT;
  return strokes.map((s) => ({
    c: s.c, width: MARK_UNITS[s.w] * scale,
    p: s.p.map((n, i) => (i % 2 ? n * scale : width / 2 + n * scale)),
  }));
}

/**
 * Whether marks show with the view as it is: only on the view they were
 * drawn on.
 * @param {Marks | undefined} marks
 * @param {Camera} camera
 */
export const marksShow = (marks, camera) => !!marks?.strokes.length && marks.camera.every((n, i) => n === camera[i]);

/**
 * Marks with a line added: to the ones showing, or in place of them if the
 * view has turned since.
 * @param {Marks | undefined} marks
 * @param {Camera} camera
 * @param {Stroke} stroke
 * @returns {Marks}
 */
export function addMark(marks, camera, stroke) {
  const line = { ...stroke, p: simplify(stroke.p) };
  return { camera: [...camera], strokes: marksShow(marks, camera) ? [.../** @type {Marks} */ (marks).strokes, line] : [line] };
}

/**
 * The mark the eraser is on, if any.
 * @param {Stroke[]} strokes
 * @param {[number, number]} point in view units
 * @returns {number} its index, or -1
 */
export const markAt = (strokes, point) => strokeAt(strokes, point, ERASER_REACH);
