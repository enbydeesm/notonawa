// A drawing drawn as SVG on the page: the thumbnails, the viewer and the
// drawing pad. The paper is a rectangle the canvas's size, with the lines
// in a group on top of it; the colors come from app.css (.ink-<color>,
// .paper), so none is set here. Also a drawing as a picture file, for
// the export and the drawing pad's download, in the colors read from
// app.css.

import { COLORS, WIDTH, HEIGHT, LINE_UNITS, strokePath, svgFile, drawing } from "./drawing-format.js";

/** @typedef {import("./drawing-format.js").Stroke} Stroke */

const SVG = "http://www.w3.org/2000/svg";

/**
 * One line as an SVG path.
 * @param {Stroke} stroke
 * @returns {SVGPathElement}
 */
export function strokeElement(stroke) {
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("class", `ink-${stroke.c}`);
  path.setAttribute("stroke-width", String(LINE_UNITS[stroke.w]));
  path.setAttribute("d", strokePath(stroke.p));
  return path;
}

/**
 * A drawing on its paper. Decorative (aria-hidden): whatever shows it says
 * what it is. Its lines are in its `g.lines`.
 * @param {Stroke[]} strokes
 * @param {string} [className]
 * @returns {SVGSVGElement}
 */
export function drawingSvg(strokes, className = "") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("class", `drawing-paper ${className}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const paper = document.createElementNS(SVG, "rect");
  paper.setAttribute("class", "paper");
  paper.setAttribute("width", String(WIDTH));
  paper.setAttribute("height", String(HEIGHT));
  const lines = document.createElementNS(SVG, "g");
  lines.setAttribute("class", "lines");
  lines.append(...strokes.map(strokeElement));
  svg.append(paper, lines);
  return svg;
}

/**
 * The colors drawings are drawn in on the page (app.css), for their
 * pictures outside it.
 * @returns {Record<import("./drawing-format.js").Color, string> & { paper: string }}
 */
export function drawingColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (/** @type {string} */ name) => style.getPropertyValue(name).trim();
  return /** @type {any} */ (Object.fromEntries([
    ["paper", read("--paper")], ...COLORS.map((c) => [c, read(`--ink-${c}`)]),
  ]));
}

/**
 * A drawing as a PNG the canvas's size: its SVG file drawn onto a canvas
 * (a phone's photos open a PNG, not an SVG).
 * @param {Stroke[]} strokes
 * @returns {Promise<Blob>}
 */
export async function drawingPng(strokes) {
  const url = URL.createObjectURL(new Blob([svgFile(drawing(strokes), drawingColors())], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d")).drawImage(image, 0, 0, WIDTH, HEIGHT);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't make a picture of the drawing."))), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
