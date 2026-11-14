// Saving a new share: sealed on this device with a key that's only in its
// link, that key and my name for the share sealed with my own data key (so
// I can show its code again), then sent. Used by every Share dialog.
//
// A share with photos and videos goes in steps: its row and snapshot, then
// each file (opened and sealed again with the link's key in the crypto
// Worker), then ready, when it can be opened. If any step fails, the share
// is revoked, so no half of it is left.

import { api } from "./api.js";
import { sealShare, sealOne } from "./vault.js";
import { shareFileObject } from "./store/index.js";
import { newShareId } from "./crypto/share.js";
import { toBase64url } from "./crypto/keys.js";
import { maxUsesFor } from "./share-options.js";

/** @typedef {{ file: string, mediaId: string, kind: "photo" | "video" }} ShareFile */

/**
 * Seals and saves a share. Throws if it can't be saved.
 * @param {{
 *   kind: import("./crypto/share.js").ShareKind, data: unknown, label: string, expires: string, uses: string,
 *   connect?: boolean, files?: ShareFile[], progress?: (done: number, total: number) => void,
 * }} share uses: "one" or "any" (share-options.js); files: my photos and
 *   videos to send with it (share-item.js's shareFiles); progress: told
 *   before each file
 * @returns {Promise<{ id: string, key: string }>} its id and link key (base64url), for its code
 */
export async function saveShare({ kind, data, label, expires, uses, connect = false, files = [], progress = () => {} }) {
  const id = newShareId();
  const { key, body } = await sealShare(id, kind, data);
  const sealed = await sealOne("share", { label, link_key: key });
  await api("/api/shares", { method: "POST", body: {
    id, kind, label: sealed.label, link_key: sealed.link_key,
    expires, max_uses: maxUsesFor(uses), snapshot: toBase64url(body), connect, files: files.length,
  } });
  if (files.length === 0) return { id, key };
  try {
    for (const [i, file] of files.entries()) {
      progress(i, files.length);
      const object = await shareFileObject({ shareId: id, linkKey: key, file });
      const query = new URLSearchParams({ kind: file.kind, thumb_bytes: String(object.thumbBytes) });
      await api(`/api/shares/${id}/files/${file.file}?${query}`, { method: "PUT", body: object.body });
    }
    await api(`/api/shares/${id}/ready`, { method: "POST" });
  } catch (err) {
    await api(`/api/shares/${id}`, { method: "DELETE" }).catch(() => {});
    throw err;
  }
  return { id, key };
}
