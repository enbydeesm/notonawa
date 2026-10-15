// Preparing a photo before it's sealed and uploaded: the image is decoded
// and redrawn on a canvas, which writes a new file with none of the
// original's metadata (GPS location, camera, times), and shrunk to save
// space. createImageBitmap applies the EXIF rotation as it decodes, so the
// photo still stands the right way up.
//
// WebP where the browser can make it (about a third smaller than JPEG),
// else JPEG: Safari's canvas quietly hands back a PNG when asked for WebP,
// so the result's type is checked.

import { FULL_EDGE, THUMB_EDGE, TARGET_BYTES, QUALITIES, THUMB_QUALITY, fileProblem, fitWithin, firstUnder } from "./photo-fit.js";

/**
 * A prepared photo: its full size and thumbnail as new files, without the
 * original's metadata.
 * @typedef {{ full: ArrayBuffer, thumb: ArrayBuffer, mime: "image/jpeg" | "image/webp" }} PreparedPhoto
 */

/**
 * @param {File} file
 * @returns {Promise<PreparedPhoto>}
 * @throws {Error} with a message to show if the file can't be used
 */
export async function preparePhoto(file) {
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That photo couldn't be read. Save it as JPEG and try again.");
  }
  try {
    const type = await outputType();
    const fullSize = fitWithin(bitmap.width, bitmap.height, FULL_EDGE);
    const full = await firstUnder(QUALITIES, (quality) => draw(bitmap, fullSize, type, quality), TARGET_BYTES);
    const thumb = await draw(bitmap, fitWithin(bitmap.width, bitmap.height, THUMB_EDGE), type, THUMB_QUALITY);
    return { full: await full.arrayBuffer(), thumb: await thumb.arrayBuffer(), mime: type };
  } finally {
    bitmap.close();
  }
}

/** @type {Promise<"image/jpeg" | "image/webp"> | null} */
let typeCheck = null;

/**
 * WebP if this browser really makes it, else JPEG (checked once).
 * @returns {Promise<"image/jpeg" | "image/webp">}
 */
function outputType() {
  typeCheck ??= (async () => {
    const canvas = canvasOf(2, 2);
    const context = /** @type {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null} */ (canvas.getContext("2d"));
    context?.fillRect(0, 0, 2, 2);
    const blob = await toBlob(canvas, "image/webp", 0.8);
    return blob.type === "image/webp" ? "image/webp" : "image/jpeg";
  })().catch(() => "image/jpeg");
  return typeCheck;
}

/**
 * Draws the image at this size and encodes it.
 * @param {ImageBitmap} bitmap
 * @param {{ width: number, height: number }} size
 * @param {string} type
 * @param {number} quality
 */
async function draw(bitmap, { width, height }, type, quality) {
  const canvas = canvasOf(width, height);
  const context = /** @type {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null} */ (canvas.getContext("2d"));
  if (!context) throw new Error("This browser can't prepare photos.");
  // White behind transparent parts (a PNG's), which JPEG would make black.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await toBlob(canvas, type, quality);
  if (blob.type !== type) throw new Error("This browser can't prepare photos.");
  return blob;
}

/**
 * An offscreen canvas where the browser has one, else a page canvas that's
 * never added to the page.
 * @param {number} width
 * @param {number} height
 * @returns {OffscreenCanvas | HTMLCanvasElement}
 */
function canvasOf(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * @param {OffscreenCanvas | HTMLCanvasElement} canvas
 * @param {string} type
 * @param {number} quality
 * @returns {Promise<Blob>}
 */
function toBlob(canvas, type, quality) {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the photo."))), type, quality);
  });
}
