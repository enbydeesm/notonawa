// A drawing drawn as SVG on the page: the thumbnails, the viewer and the
// drawing pad. The paper is a rectangle the canvas's size, with the lines
// in a group on top of it; the colors come from app.css (.ink-<color>,
// .paper), so none is set here.

import { WIDTH, HEIGHT, LINE_UNITS, strokePath } from "./drawing-format.js";

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
