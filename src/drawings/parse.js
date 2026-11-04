// Drawings: their format, limits and request parsing. Pure, so it's easy to
// test.
//
// A drawing is kept as its lines, not as a picture, so it can be edited
// again (an eraser takes out a whole line, undo goes back past a save) and
// its copies edited separately. It's plain JSON, which the server checks:
//   { v: 1, strokes: [{ c: "red", w: 2, p: [x0, y0, x1, y1, …] }, …] }
// c is one of COLORS (the page draws each with its CSS color), w a width
// 1–3, and p a line's points, whole numbers on a WIDTH × HEIGHT canvas (one
// point is a dot). public/js/drawing-format.js has the same rules; a unit
// test keeps the two in step.

import { BadInput } from "../http.js";
import { parseCaption } from "../media/parse.js";

// A caption is sealed in the browser, or empty, as a photo's is.
export { parseCaption };

export const FORMAT_VERSION = 1;
/** The canvas, in the units the points are in: portrait, 3:4. */
export const WIDTH = 900;
export const HEIGHT = 1200;
// Every color a line or rope can be saved in. Jute came last, for the
// poser (its ropes and pencil), so older lines keep their colors.
export const COLORS = /** @type {const} */ (["black", "grey", "red", "orange", "green", "blue", "purple", "pink", "jute"]);
export const WIDTHS = /** @type {const} */ ([1, 2, 3]);
/** Lines in one drawing. */
export const MAX_STROKES = 2000;
/** Numbers (two a point) in one line. */
export const MAX_LINE_NUMBERS = 4000;
/** Numbers in one drawing, all its lines together. */
export const MAX_NUMBERS = 100_000;
/** Drawings on one tie, plan or workshop. */
export const MAX_PER_ITEM = 20;
/** The largest request body: a drawing at its limits, and a caption. */
export const MAX_BODY_BYTES = 600 * 1024;

/**
 * @typedef {{ c: typeof COLORS[number], w: typeof WIDTHS[number], p: number[] }} Stroke
 * @typedef {{ v: 1, strokes: Stroke[] }} Drawing
 */

// Made by the server with crypto.randomUUID().
const DRAWING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function parseDrawingId(value) {
  if (typeof value !== "string" || !DRAWING_ID.test(value)) throw new BadInput("That isn't a drawing id.");
  return value;
}

/**
 * A drawing as sent, checked and rebuilt with only what the format has (so
 * nothing else sent along is stored).
 * @param {unknown} value
 * @returns {Drawing}
 */
export function parseDrawing(value) {
  const bad = (/** @type {string} */ why) => new BadInput(`Couldn't save the drawing: ${why}`);
  const doc = /** @type {Record<string, any>} */ (value);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw bad("it was missing.");
  if (doc.v !== FORMAT_VERSION) throw bad("it's from a newer version of NotoNawa. Reload the page and try again.");
  if (!Array.isArray(doc.strokes)) throw bad("it has no lines.");
  if (doc.strokes.length === 0) throw bad("draw something first.");
  if (doc.strokes.length > MAX_STROKES) throw bad(`it has more than ${MAX_STROKES.toLocaleString()} lines.`);
  let numbers = 0;
  const strokes = doc.strokes.map((/** @type {any} */ s) => {
    if (!s || typeof s !== "object" || !COLORS.includes(s.c) || !WIDTHS.includes(s.w) || !Array.isArray(s.p)) {
      throw bad("a line isn't in the right format.");
    }
    const p = s.p;
    if (p.length < 2 || p.length % 2 !== 0 || p.length > MAX_LINE_NUMBERS) throw bad("a line has too many or too few points.");
    for (let i = 0; i < p.length; i++) {
      const max = i % 2 === 0 ? WIDTH : HEIGHT;
      if (!Number.isInteger(p[i]) || p[i] < 0 || p[i] > max) throw bad("a line goes off the page.");
    }
    numbers += p.length;
    return { c: s.c, w: s.w, p: [...p] };
  });
  if (numbers > MAX_NUMBERS) throw bad("it's too detailed to store.");
  return { v: FORMAT_VERSION, strokes };
}

/**
 * An edit: new lines, a new caption, or both (a field left out is kept).
 * @param {Record<string, any>} body
 * @returns {{ data?: Drawing, caption?: string | null }}
 */
export function parseEdit(body) {
  /** @type {{ data?: Drawing, caption?: string | null }} */
  const edit = {};
  if ("data" in body) edit.data = parseDrawing(body.data);
  if ("caption" in body) edit.caption = parseCaption(body.caption);
  if (!("data" in edit) && !("caption" in edit)) throw new BadInput("Nothing to change: send data or caption.");
  return edit;
}
