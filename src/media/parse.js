// Photos: limits and request parsing. Pure, so it's easy to test.
//
// The browser prepares each photo (strips metadata, makes a thumbnail),
// seals both, and uploads them as one object: the thumbnail's bytes, then
// the full size's. Only sizes, ids and the kind of file travel in the URL;
// nothing the user typed.

import { BadInput } from "../http.js";
import { encryptedText } from "../parse.js";

/** The largest object stored (thumbnail and full size, sealed). */
export const MAX_OBJECT_BYTES = 10 * 1024 * 1024;
/** Photos per tie or plan. */
export const MAX_PER_ITEM = 30;
/** All of an account's photos together. */
export const MAX_ACCOUNT_BYTES = 1024 * 1024 * 1024;
/** A sealed caption (a caption is up to 200 characters; sealing adds a third and more). */
export const MAX_SEALED_CAPTION = 2000;

/** What can be uploaded so far; videos come later (see roadmap.md). */
export const KINDS = /** @type {const} */ (["photo"]);
export const MIMES = /** @type {const} */ (["image/jpeg", "image/webp"]);

// Made by the browser with crypto.randomUUID(): the encryption is bound to it.
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// A tie's or plan's id (checked against the database afterwards).
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * What a photo belongs to. column is only ever one of these two names, so
 * it can go into SQL.
 * @typedef {{ column: "tie_id" | "plan_id", table: "ties" | "plans", id: string }} Item
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function parseMediaId(value) {
  if (typeof value !== "string" || !MEDIA_ID.test(value)) throw new BadInput("That isn't a photo id.");
  return value;
}

/**
 * The tie or plan, from { tie_id } or { plan_id } (exactly one).
 * @param {{ tie_id?: unknown, plan_id?: unknown }} source query parameters or a JSON body
 * @returns {Item}
 */
export function parseItem(source) {
  const tie = source.tie_id ?? null;
  const plan = source.plan_id ?? null;
  if ((tie === null) === (plan === null)) throw new BadInput("Say which tie or plan: tie_id or plan_id.");
  const id = tie ?? plan;
  if (typeof id !== "string" || !ITEM_ID.test(id)) throw new BadInput("That isn't a tie or plan id.");
  return tie !== null ? { column: "tie_id", table: "ties", id } : { column: "plan_id", table: "plans", id };
}

/**
 * @typedef {{
 *   id: string, item: Item, kind: typeof KINDS[number], mime: typeof MIMES[number],
 *   thumbBytes: number, bytes: number,
 * }} Upload
 */

/**
 * An upload: PUT /api/media/:id?tie_id=…|plan_id=…&kind=…&mime=…&thumb_bytes=…
 * with the object as the body.
 * @param {string} id from the path
 * @param {URLSearchParams} params
 * @param {string | null} contentLength the request's Content-Length
 * @returns {Upload}
 */
export function parseUpload(id, params, contentLength) {
  const item = parseItem({ tie_id: params.get("tie_id") ?? undefined, plan_id: params.get("plan_id") ?? undefined });
  const kind = params.get("kind");
  const mime = params.get("mime");
  if (!KINDS.includes(/** @type {any} */ (kind))) throw new BadInput("Only photos can be added.");
  if (!MIMES.includes(/** @type {any} */ (mime))) throw new BadInput("Only JPEG and WebP photos can be stored.");
  const bytes = Number(contentLength);
  if (contentLength === null || !Number.isInteger(bytes) || bytes <= 0) {
    throw new BadInput("Couldn't upload: the photo's size wasn't sent.");
  }
  if (bytes > MAX_OBJECT_BYTES) throw new BadInput("That photo is too big to store, even after shrinking it.");
  const thumbBytes = Number(params.get("thumb_bytes"));
  if (!Number.isInteger(thumbBytes) || thumbBytes <= 0 || thumbBytes >= bytes) {
    throw new BadInput("Couldn't upload: the thumbnail's size is wrong.");
  }
  return {
    id: parseMediaId(id), item,
    kind: /** @type {Upload["kind"]} */ (kind), mime: /** @type {Upload["mime"]} */ (mime),
    thumbBytes, bytes,
  };
}

/**
 * Why an upload can't be stored, or null if it can.
 * @param {{ count: number, accountBytes: number }} used the item's photos, and the account's bytes
 * @param {number} bytes the new photo's
 * @returns {string | null}
 */
export function limitProblem({ count, accountBytes }, bytes) {
  if (count >= MAX_PER_ITEM) return `There can be at most ${MAX_PER_ITEM} photos on a tie or plan.`;
  if (accountBytes + bytes > MAX_ACCOUNT_BYTES) return "Your photos have filled your 1 GB. Delete some to make room.";
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

/**
 * A new order for an item's photos: every one of its photo ids, once each,
 * first to last.
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseOrder(value) {
  if (!Array.isArray(value) || value.length > MAX_PER_ITEM) throw new BadInput("Expected the photos' ids in order.");
  const ids = value.map(parseMediaId);
  if (new Set(ids).size !== ids.length) throw new BadInput("Each photo can only be listed once.");
  return ids;
}

/**
 * Whether two lists hold the same ids (in any order).
 * @param {string[]} a
 * @param {string[]} b
 */
export function sameIds(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
