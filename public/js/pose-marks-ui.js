// The poser's pencil marks on the page (pose-marks.js has their rules): an
// SVG laid over the 3D view, and the marks drawn onto a picture of the pose.

import { strokePath } from "./drawing-format.js";
import { drawingColors } from "./drawing-svg.js";
import { MARK_UNITS, viewBox, onPicture } from "./pose-marks.js";

/** @typedef {import("./drawing-format.js").Stroke} Stroke */

const SVG = "http://www.w3.org/2000/svg";

/**
 * The layer over the view the marks show on (and are drawn on, in pencil
 * mode: `.drawing` takes the view's taps).
 */
export function marksLayer() {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "drawing-paper pose-marks");
  svg.setAttribute("id", "pose-marks");
  svg.setAttribute("aria-hidden", "true");

  /**
   * Shows these marks, at the view's size now.
   * @param {Stroke[]} strokes
   */
  function draw(strokes) {
    const { width, height } = svg.getBoundingClientRect();
    if (width > 0 && height > 0) svg.setAttribute("viewBox", viewBox({ width, height }));
    svg.replaceChildren(...strokes.map((s) => {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("class", `ink-${s.c}`);
      path.setAttribute("stroke-width", String(MARK_UNITS[s.w]));
      path.setAttribute("d", strokePath(s.p));
      return path;
    }));
  }

  return { svg, draw };
}

/**
 * A picture with marks drawn over it, as a PNG.
 * @param {Blob} picture
 * @param {Stroke[]} strokes
 * @param {{ width: number, height: number }} size the picture's
 * @returns {Promise<Blob>}
 */
export async function withMarks(picture, strokes, size) {
  const image = await createImageBitmap(picture);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  context.drawImage(image, 0, 0, size.width, size.height);
  image.close();
  const colors = drawingColors();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const line of onPicture(strokes, size)) {
    context.strokeStyle = colors[line.c];
    context.lineWidth = line.width;
    context.stroke(new Path2D(strokePath(line.p)));
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't make a picture of the pose."))), "image/png");
  });
}
