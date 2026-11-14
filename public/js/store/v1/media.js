// Photos and videos on ties, plans and workshops, through today's API
// (format 1). Uploading one prepared photo (photo-prep.js) or video
// (video-prep.js): sealed in the crypto Worker, bound to a new id made here,
// then sent as one object, last on its item; then its caption, sealed too.
// Used by the Visuals section, the poser and import; uploadSealed by adding
// a share's photos, which the Worker has sealed already. See store/index.js.

import { api } from "../../api.js";
import { sealPhoto, sealVideo, sealCaption, openMedia, openPhoto, copyMedia } from "../../vault.js";

/** @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item */
/** @typedef {import("../../photo-prep.js").PreparedPhoto} PreparedPhoto */
/** @typedef {import("../../video-prep.js").PreparedVideo} PreparedVideo */

/**
 * @param {{ item: Item, prepared: PreparedPhoto | PreparedVideo, caption?: string | null, id?: string }} photo
 *   prepared's buffers are handed to the crypto Worker, so they're emptied
 * @returns {Promise<string>} the photo's id
 */
export async function uploadPhoto({ item, prepared, caption = null, id = crypto.randomUUID() }) {
  // Sealed first, so a caption that's too long stops the upload rather
  // than leaving a photo without it.
  const sealedCaption = caption ? await sealCaption(id, caption) : null;
  const video = "kind" in prepared && prepared.kind === "video";
  const sealed = await (video ? sealVideo : sealPhoto)(id, prepared.thumb, prepared.full);
  await sendSealed({ item, id, kind: video ? "video" : "photo", mime: prepared.mime, ...sealed }, sealedCaption);
  return id;
}

/**
 * Uploads a photo or video already sealed as mine, bound to id
 * (vault.adoptShareFile), and its caption.
 * @param {{
 *   item: Item, id: string, kind: "photo" | "video", mime: string, body: ArrayBuffer, thumbBytes: number,
 *   caption?: string | null,
 * }} photo
 */
export async function uploadSealed({ caption = null, ...photo }) {
  await sendSealed(photo, caption ? await sealCaption(photo.id, caption) : null);
}

/**
 * @param {{ item: Item, id: string, kind: "photo" | "video", mime: string, body: ArrayBuffer, thumbBytes: number }} photo
 * @param {string | null} sealedCaption
 */
async function sendSealed({ item, id, kind, mime, body, thumbBytes }, sealedCaption) {
  const query = new URLSearchParams({ ...item, kind, mime, thumb_bytes: String(thumbBytes) });
  await api(`/api/media/${id}?${query}`, { method: "PUT", body });
  if (sealedCaption) await api(`/api/media/${id}`, { method: "PATCH", body: { caption: sealedCaption } });
}

/**
 * An item's photos and videos, in their place in its visuals, captions
 * opened (null, with unreadable, if one won't).
 * @param {Item} item
 * @returns {Promise<{ id: string, kind: "photo" | "video", mime: string, caption: string | null,
 *   unreadable?: string[], position: number, created_at: string, bytes?: number }[]>}
 */
export async function listMedia(item) {
  /** @type {{ id: string, kind: "photo" | "video", mime: string, caption: string | null, position: number, created_at: string }[]} */
  const listed = await api(`/api/media?${new URLSearchParams(item)}`);
  const opened = await openMedia(listed);
  return opened.map((p, i) => ({ ...listed[i], ...p }));
}

/**
 * A saved photo's or video's caption (empty or null to clear it), sealed
 * bound to it here.
 * @param {string} id
 * @param {string | null} caption
 */
export async function setMediaCaption(id, caption) {
  await api(`/api/media/${encodeURIComponent(id)}`, { method: "PATCH", body: { caption: await sealCaption(id, caption ?? "") } });
}

/** @param {string} id */
export async function deleteMedia(id) {
  await api(`/api/media/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * One part of a saved photo or video, opened (the Worker fetches it).
 * Throws CantOpen if it won't open.
 * @param {{ id: string, kind: "photo" | "video" }} photo
 * @param {"thumb" | "full"} part
 * @returns {Promise<ArrayBuffer>}
 */
export function openMediaPart(photo, part) {
  return openPhoto(photo.id, part, photo.kind);
}

/**
 * A copy of a saved photo or video on another item (Copy to…): opened and
 * sealed again bound to a new id in the crypto Worker, then uploaded.
 * @param {{ id: string, kind: "photo" | "video", mime: string, caption: string | null }} photo
 * @param {Item} to
 * @returns {Promise<string>} the copy's id
 */
export async function copyMediaTo(photo, to) {
  const id = crypto.randomUUID();
  const sealed = await copyMedia({ mediaId: photo.id, newId: id, kind: photo.kind });
  await uploadSealed({ item: to, id, kind: photo.kind, mime: photo.mime, caption: photo.caption, ...sealed });
  return id;
}
