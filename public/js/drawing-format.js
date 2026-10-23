// Drawings as lines: the format, and turning lines into SVG. Pure, so it's
// easy to test.
//
// A drawing is { v: 1, strokes: [{ c, w, p }] }: each line's color (one of
// COLORS, drawn with the CSS color --ink-<c>), width (1–3) and points
// [x0, y0, x1, y1, …], whole numbers on a WIDTH × HEIGHT canvas. Kept as
// lines, not a picture, so a drawing can be edited again and its copies
// edited separately. src/drawings/parse.js checks the same rules (a unit
// test keeps the two in step).

export const FORMAT_VERSION = 1;
/** The canvas, in the units the points are in: portrait, 3:4. */
export const WIDTH = 900;
export const HEIGHT = 1200;
export const COLORS = /** @type {const} */ (["black", "grey", "red", "orange", "green", "blue", "purple", "pink"]);
/** Each width's thickness on the canvas. */
export const LINE_UNITS = /** @type {const} */ ({ 1: 4, 2: 10, 3: 24 });
/** The most drawings on one tie, plan or workshop (also checked by the server). */
export const MAX_DRAWINGS = 20;
/** Lines in one drawing (also checked by the server). */
export const MAX_STROKES = 2000;
/** Numbers (two a point) in one line (also checked by the server). */
export const MAX_LINE_NUMBERS = 4000;
/** How far (in canvas units) a point can be from the line left when simplifying it. */
export const SIMPLIFY_UNITS = 1.5;

/**
 * @typedef {typeof COLORS[number]} Color
 * @typedef {1 | 2 | 3} Width
 * @typedef {{ c: Color, w: Width, p: number[] }} Stroke
 * @typedef {{ v: 1, strokes: Stroke[] }} Drawing
 */

/**
 * @param {Stroke[]} strokes
 * @returns {Drawing}
 */
export function drawing(strokes) {
  return { v: FORMAT_VERSION, strokes };
}

/**
 * A point in canvas units as stored: whole units, kept on the canvas (a
 * line drawn off the edge runs along it).
 * @param {{ x: number, y: number }} point in canvas units
 * @returns {[number, number]}
 */
export function toCanvas({ x, y }) {
  const clamp = (/** @type {number} */ v, /** @type {number} */ max) => Math.min(max, Math.max(0, Math.round(v)));
  return [clamp(x, WIDTH), clamp(y, HEIGHT)];
}

/**
 * A line with the points it doesn't need taken out (Ramer–Douglas–Peucker):
 * none left is further than `tolerance` from the line through the rest.
 * @param {number[]} p [x0, y0, x1, y1, …]
 * @param {number} [tolerance]
 * @returns {number[]}
 */
export function simplify(p, tolerance = SIMPLIFY_UNITS) {
  const count = p.length / 2;
  if (count <= 2) return [...p];
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  /** @type {[number, number][]} */
  const stack = [[0, count - 1]];
  while (stack.length) {
    const [first, last] = /** @type {[number, number]} */ (stack.pop());
    let furthest = -1;
    let furthestDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(p[i * 2], p[i * 2 + 1], p[first * 2], p[first * 2 + 1], p[last * 2], p[last * 2 + 1]);
      if (d > furthestDistance) {
        furthest = i;
        furthestDistance = d;
      }
    }
    if (furthest >= 0) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < count; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

/**
 * How far a point is from the segment between two others.
 * @param {number} x @param {number} y the point
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by the segment
 */
export function segmentDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/**
 * An SVG path for a line: smoothed, curving through the middle of each pair
 * of points. A single point is a dot (the round line cap draws it).
 * @param {number[]} p
 * @returns {string}
 */
export function strokePath(p) {
  if (p.length < 2) return "";
  if (p.length <= 4) {
    const [x1, y1, x2 = x1, y2 = y1] = p;
    return `M${x1} ${y1}L${x2} ${y2}`;
  }
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2;
    const my = (p[i + 1] + p[i + 3]) / 2;
    d += `Q${p[i]} ${p[i + 1]} ${mx} ${my}`;
  }
  return d + `L${p[p.length - 2]} ${p[p.length - 1]}`;
}

/**
 * A drawing as an SVG file, for the export's zip (outside the app, where
 * the CSS colors aren't, so they're passed in).
 * @param {Drawing} doc
 * @param {Record<Color, string> & { paper: string }} colors CSS colors, e.g. "#222"
 * @returns {string}
 */
export function svgFile(doc, colors) {
  const paths = doc.strokes.map((s) =>
    `<path d="${strokePath(s.p)}" stroke="${colors[s.c]}" stroke-width="${LINE_UNITS[s.w]}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">\n` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${colors.paper}"/>\n` +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">\n${paths.join("\n")}\n</g>\n</svg>\n`;
}
