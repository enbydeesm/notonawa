// Preparing a photo: the pure parts (sizes, limits, choosing a quality),
// kept apart from the canvas work in photo-prep.js so they can be tested
// without a browser.

/** The file types the picker offers. Leaving HEIC out makes iPhones convert to JPEG. */
export const ACCEPT = "image/jpeg,image/png,image/webp";
/** The biggest file taken in (it's shrunk long before it's stored). */
export const MAX_INPUT_BYTES = 30 * 1024 * 1024;
/** The full size's longest side, in pixels. */
export const FULL_EDGE = 2048;
/** The thumbnail's longest side, in pixels. */
export const THUMB_EDGE = 320;
/** What the full size aims to stay under. */
export const TARGET_BYTES = 500 * 1024;
/** Qualities tried in turn until the full size is under TARGET_BYTES. */
export const QUALITIES = [0.82, 0.72, 0.62];
/** The thumbnail's quality. */
export const THUMB_QUALITY = 0.7;

/**
 * Why a chosen file can't be added, or null if it can be tried.
 * @param {{ type: string, size: number }} file
 * @returns {string | null}
 */
export function fileProblem({ type, size }) {
  if (/^image\/hei[cf]/.test(type)) return "HEIC photos can't be read here. Save it as JPEG and try again.";
  if (type && !ACCEPT.split(",").includes(type)) return "Only JPEG, PNG and WebP photos can be added.";
  if (size > MAX_INPUT_BYTES) return "That photo is over 30 MB.";
  return null;
}

/**
 * A width and height no longer than edge on their longest side, keeping the
 * shape (never enlarged).
 * @param {number} width
 * @param {number} height
 * @param {number} edge
 * @returns {{ width: number, height: number }}
 */
export function fitWithin(width, height, edge) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Of encodings tried in turn (best quality first), the first under the
 * target, or the last if none is.
 * @param {number[]} qualities
 * @param {(quality: number) => Promise<Blob>} encode
 * @param {number} target
 * @returns {Promise<Blob>}
 */
export async function firstUnder(qualities, encode, target) {
  /** @type {Blob | null} */
  let blob = null;
  for (const quality of qualities) {
    blob = await encode(quality);
    if (blob.size <= target) break;
  }
  if (!blob) throw new Error("No qualities to try.");
  return blob;
}
