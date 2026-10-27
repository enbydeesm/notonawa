// Saving a new share: sealed on this device with a key that's only in its
// link, that key and my name for the share sealed with my own data key (so
// I can show its code again), then sent. Used by every Share dialog.

import { api } from "./api.js";
import { sealShare, sealOne } from "./vault.js";
import { newShareId } from "./crypto/share.js";
import { toBase64url } from "./crypto/keys.js";
import { maxUsesFor } from "./share-options.js";

/**
 * Seals and saves a share. Throws if it can't be saved.
 * @param {{
 *   kind: import("./crypto/share.js").ShareKind, data: unknown, label: string, expires: string, uses: string,
 *   connect?: boolean,
 * }} share uses: "one" or "any" (share-options.js)
 * @returns {Promise<{ id: string, key: string }>} its id and link key (base64url), for its code
 */
export async function saveShare({ kind, data, label, expires, uses, connect = false }) {
  const id = newShareId();
  const { key, body } = await sealShare(id, kind, data);
  const sealed = await sealOne("share", { label, link_key: key });
  await api("/api/shares", { method: "POST", body: {
    id, kind, label: sealed.label, link_key: sealed.link_key,
    expires, max_uses: maxUsesFor(uses), snapshot: toBase64url(body), connect,
  } });
  return { id, key };
}
