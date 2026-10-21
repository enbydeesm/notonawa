// Uploading one prepared photo (photo-prep.js) or video (video-prep.js) to
// a tie or plan: sealed in the crypto Worker, bound to a new id made here,
// then sent as one object, last on its tie or plan; then its caption, sealed
// too. Used by the Photos section and by import.

import { api } from "./api.js";
import { sealPhoto, sealVideo, sealCaption } from "./vault.js";

/** @typedef {{ tie_id: string } | { plan_id: string }} Item */
/** @typedef {import("./photo-prep.js").PreparedPhoto} PreparedPhoto */
/** @typedef {import("./video-prep.js").PreparedVideo} PreparedVideo */

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
  const { body, thumbBytes } = await (video ? sealVideo : sealPhoto)(id, prepared.thumb, prepared.full);
  const query = new URLSearchParams({
    ...item, kind: video ? "video" : "photo", mime: prepared.mime, thumb_bytes: String(thumbBytes),
  });
  await api(`/api/media/${id}?${query}`, { method: "PUT", body });
  if (sealedCaption) await api(`/api/media/${id}`, { method: "PATCH", body: { caption: sealedCaption } });
  return id;
}
