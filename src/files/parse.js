// Format v3 files (photos and videos, sealed on the device): checking what
// a device sends. The server stores each as one object and never reads it.
// Pure, so it's easy to test.

import { BadInput } from "../http.js";
import { MAX_OBJECT_BYTES, MAX_VIDEO_BYTES, MAX_ACCOUNT_BYTES } from "../media/parse.js";

export const KINDS = /** @type {const} */ (["photo", "video"]);
/** Ids one delete takes, at most. */
export const MAX_DELETE = 1000;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * @typedef {{ id: string, kind: typeof KINDS[number], thumbBytes: number, bytes: number }} Upload
 */

/** @param {unknown} value */
export function parseFileId(value) {
  if (typeof value !== "string" || !ID.test(value)) throw new BadInput("That isn't a file's id.");
  return value;
}

/**
 * PUT /api/files/:id?kind=&thumb_bytes=, its size from Content-Length.
 * @param {string} id
 * @param {URLSearchParams} params
 * @param {string | null} contentLength
 * @returns {Upload}
 */
export function parseUpload(id, params, contentLength) {
  const kind = params.get("kind");
  if (!KINDS.includes(/** @type {any} */ (kind))) throw new BadInput("Only photos and videos can be added.");
  const video = kind === "video";
  const bytes = Number(contentLength);
  if (contentLength === null || !Number.isInteger(bytes) || bytes <= 0) throw new BadInput(`Couldn't upload: the ${kind}'s size wasn't sent.`);
  if (bytes > (video ? MAX_VIDEO_BYTES : MAX_OBJECT_BYTES)) {
    throw new BadInput(video
      ? "That video is too big to store, even after shrinking it. Try cropping or shortening it, or lowering its quality, then add it again."
      : "That photo is too big to store, even after shrinking it.");
  }
  const thumbBytes = Number(params.get("thumb_bytes"));
  if (!Number.isInteger(thumbBytes) || thumbBytes <= 0 || thumbBytes >= bytes) throw new BadInput("Couldn't upload: the thumbnail's size is wrong.");
  return { id: parseFileId(id), kind: /** @type {Upload["kind"]} */ (kind), thumbBytes, bytes };
}

/**
 * POST /api/files/delete's ids.
 * @param {any} body
 * @returns {string[]}
 */
export function parseDeleteIds(body) {
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_DELETE) throw new BadInput(`Send up to ${MAX_DELETE} file ids to delete.`);
  return [...new Set(ids.map(parseFileId))];
}

/**
 * The bytes an account may still add. While converting, its format 1 photos
 * and videos don't count: both copies are kept until it's converted.
 * @param {{ accountBytes: number, mediaBytes: number, converting: boolean }} used
 */
export function roomLeft({ accountBytes, mediaBytes, converting }) {
  return MAX_ACCOUNT_BYTES - (accountBytes - (converting ? mediaBytes : 0));
}
