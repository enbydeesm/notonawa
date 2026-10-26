// Photos and videos: limits and request parsing. Pure, so it's easy to test.
//
// The browser prepares each photo or video (strips metadata, shrinks it,
// makes a thumbnail), seals both, and uploads them as one object: the
// thumbnail's bytes, then the full size's. Only sizes, ids and the kind of
// file travel in the URL; nothing the user typed.

import { BadInput } from "../http.js";
import { encryptedText } from "../parse.js";

/** The largest photo stored (thumbnail and full size, sealed). */
export const MAX_OBJECT_BYTES = 10 * 1024 * 1024;
/**
 * The largest video stored. A 3-minute clip at 480p comes to about 30 MB;
 * this leaves room for encoders that overshoot, and keeps every upload one
 * request well under a Worker's 100 MB.
 */
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
/** Photos and videos per tie or plan. */
export const MAX_PER_ITEM = 30;
/** Of those, videos. */
export const MAX_VIDEOS_PER_ITEM = 5;
/** All of an account's photos, videos and shares together. */
export const MAX_ACCOUNT_BYTES = 1024 * 1024 * 1024;
/** A sealed caption (a caption is up to 200 characters; sealing adds a third and more). */
export const MAX_SEALED_CAPTION = 2000;

export const KINDS = /** @type {const} */ (["photo", "video"]);
/** The types each kind is stored as (the browser re-encodes to these). */
export const MIMES = /** @type {const} */ ({ photo: ["image/jpeg", "image/webp"], video: ["video/mp4"] });

// Made by the browser with crypto.randomUUID(): the encryption is bound to it.
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// A tie's, plan's or workshop's id (checked against the database afterwards).
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * What a photo belongs to. column and table are only ever these fixed
 * names, so they can go into SQL.
 * @typedef {{
 *   column: "tie_id" | "plan_id" | "workshop_id",
 *   table: "ties" | "plans" | "workshops",
 *   id: string,
 * }} Item
 */

/** The parameter naming each kind of item, and its table. */
export const ITEM_COLUMNS = /** @type {const} */ ({ tie_id: "ties", plan_id: "plans", workshop_id: "workshops" });

/**
 * @param {unknown} value
 * @returns {string}
 */
export function parseMediaId(value) {
  if (typeof value !== "string" || !MEDIA_ID.test(value)) throw new BadInput("That isn't a photo id.");
  return value;
}

/**
 * The tie, plan or workshop, from { tie_id }, { plan_id } or { workshop_id }
 * (exactly one).
 * @param {{ tie_id?: unknown, plan_id?: unknown, workshop_id?: unknown }} source query parameters or a JSON body
 * @returns {Item}
 */
export function parseItem(source) {
  const given = /** @type {(keyof typeof ITEM_COLUMNS)[]} */ (Object.keys(ITEM_COLUMNS))
    .filter((column) => (source[column] ?? null) !== null);
  if (given.length !== 1) throw new BadInput("Say which tie, plan or workshop: tie_id, plan_id or workshop_id.");
  const column = given[0];
  const id = source[column];
  if (typeof id !== "string" || !ITEM_ID.test(id)) throw new BadInput("That isn't a tie, plan or workshop id.");
  return { column, table: ITEM_COLUMNS[column], id };
}

/**
 * The item from a request's query parameters.
 * @param {URLSearchParams} params
 * @returns {Item}
 */
export function itemFromParams(params) {
  return parseItem(Object.fromEntries(
    Object.keys(ITEM_COLUMNS).map((column) => [column, params.get(column) ?? undefined])));
}

/**
 * @typedef {{
 *   id: string, item: Item, kind: typeof KINDS[number], mime: string,
 *   thumbBytes: number, bytes: number,
 * }} Upload
 */

/**
 * An upload: PUT /api/media/:id?tie_id=…|plan_id=…|workshop_id=…&kind=…&mime=…&thumb_bytes=…
 * with the object as the body.
 * @param {string} id from the path
 * @param {URLSearchParams} params
 * @param {string | null} contentLength the request's Content-Length
 * @returns {Upload}
 */
export function parseUpload(id, params, contentLength) {
  const item = itemFromParams(params);
  const kind = params.get("kind");
  const mime = params.get("mime");
  if (!KINDS.includes(/** @type {any} */ (kind))) throw new BadInput("Only photos and videos can be added.");
  const video = kind === "video";
  if (!(/** @type {readonly string[]} */ (MIMES[/** @type {Upload["kind"]} */ (kind)])).includes(mime ?? "")) {
    throw new BadInput(video ? "Only MP4 videos can be stored." : "Only JPEG and WebP photos can be stored.");
  }
  const bytes = Number(contentLength);
  if (contentLength === null || !Number.isInteger(bytes) || bytes <= 0) {
    throw new BadInput(`Couldn't upload: the ${kind}'s size wasn't sent.`);
  }
  if (bytes > (video ? MAX_VIDEO_BYTES : MAX_OBJECT_BYTES)) {
    throw new BadInput(`That ${kind} is too big to store, even after shrinking it.`);
  }
  const thumbBytes = Number(params.get("thumb_bytes"));
  if (!Number.isInteger(thumbBytes) || thumbBytes <= 0 || thumbBytes >= bytes) {
    throw new BadInput("Couldn't upload: the thumbnail's size is wrong.");
  }
  return {
    id: parseMediaId(id), item,
    kind: /** @type {Upload["kind"]} */ (kind), mime: /** @type {string} */ (mime),
    thumbBytes, bytes,
  };
}

/**
 * Why an upload can't be stored, or null if it can.
 * @param {{ count: number, videoCount: number, accountBytes: number }} used the item's photos and
 *   videos, its videos, and the account's bytes
 * @param {{ kind: Upload["kind"], bytes: number }} upload
 * @returns {string | null}
 */
export function limitProblem({ count, videoCount, accountBytes }, { kind, bytes }) {
  if (count >= MAX_PER_ITEM) return `There can be at most ${MAX_PER_ITEM} photos and videos on a tie or plan.`;
  if (kind === "video" && videoCount >= MAX_VIDEOS_PER_ITEM) {
    return `There can be at most ${MAX_VIDEOS_PER_ITEM} videos on a tie or plan.`;
  }
  if (accountBytes + bytes > MAX_ACCOUNT_BYTES) return "Your photos, videos and shares have filled your 1 GB. Delete some to make room.";
  return null;
}

/**
 * A caption: sealed in the browser, or empty.
 * @param {unknown} value
 * @returns {string | null}
 */
export function parseCaption(value) {
  let caption;
  try {
    caption = encryptedText(value);
  } catch {
    throw new BadInput("Couldn't save the caption: it wasn't encrypted. Reload the page and try again.");
  }
  if (caption !== null && caption.length > MAX_SEALED_CAPTION) throw new BadInput("That caption is too long.");
  return caption;
}

