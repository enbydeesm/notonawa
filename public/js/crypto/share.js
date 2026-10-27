// Shares: sealed copies of a profile, tie, plan or workshop that someone
// else opens with a link. Pure apart from WebCrypto, so it's easy to test;
// used by the crypto Worker (vault-core.js). See considerations.md, "Sharing
// between accounts".
//
// Each share has its own random 32-byte key, which travels only in the
// link, after the "#" (never sent to the server):
//
//   /open#<share id>.<key>
//
// The snapshot (the copy, as JSON) is sealed with AES-256-GCM under a key
// made from it with HKDF ("notonawa share v1 snapshot"), so a passphrase
// can later be mixed in without changing the format. The additional data
// binds it to the share's id, kind and format version, so the server can't
// pass one share off as another. Stored as a 12-byte IV, then the
// ciphertext with its tag. The data key is never used for any of it.
//
// Its photos and videos are sealed with another key made from the link's
// ("notonawa share v1 file"), in the same format as my own (media.js: the
// thumbnail, then the full size, a video's in pieces), each part bound to
// the share's id and the file's own id (a random UUID, listed only in the
// snapshot), so the server can't swap one share's file for another's.

import { toBase64url, fromBase64url } from "./keys.js";
import { CantOpen } from "./fields.js";
import { sealObject, openObjectPart } from "./media.js";

export const SHARE_VERSION = 1;
export const SHARE_KINDS = /** @type {const} */ (["profile", "tie", "plan", "workshop"]);

/** @typedef {typeof SHARE_KINDS[number]} ShareKind */

const encode = (/** @type {string} */ text) => /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(text));

// 16 random bytes (22 characters) and 32 (43), base64url.
const FRAGMENT = /^#?([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

/** A new share's id: 16 random bytes, base64url (the server checks the same). */
export function newShareId() {
  return toBase64url(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * A new share's key: 32 random bytes, only ever in the link.
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function newShareKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * @param {string} id
 * @param {ShareKind} kind
 */
function additionalData(id, kind) {
  return encode(`notonawa|share|v${SHARE_VERSION}|${id}|${kind}`);
}

/**
 * An AES key a share's link key makes, for its snapshot or its files.
 * @param {Uint8Array<ArrayBuffer>} linkKey
 * @param {"snapshot" | "file"} what
 * @param {"encrypt" | "decrypt"} use
 */
async function derivedKey(linkKey, what, use) {
  const material = await crypto.subtle.importKey("raw", linkKey, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encode(`notonawa share v${SHARE_VERSION} ${what}`) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [use]
  );
}

/**
 * @param {Uint8Array<ArrayBuffer>} linkKey
 * @param {"encrypt" | "decrypt"} use
 */
const snapshotKey = (linkKey, use) => derivedKey(linkKey, "snapshot", use);

/**
 * Seals a share's snapshot.
 * @param {{ id: string, kind: ShareKind, key: Uint8Array<ArrayBuffer>, data: unknown }} share
 * @returns {Promise<Uint8Array<ArrayBuffer>>} the IV, then the ciphertext
 */
export async function sealSnapshot({ id, kind, key, data }) {
  if (!SHARE_KINDS.includes(kind)) throw new Error(`Not a kind of share: ${kind}`);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(id, kind) },
    await snapshotKey(key, "encrypt"),
    encode(JSON.stringify(data))
  ));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return out;
}

/**
 * Opens a share's snapshot. Throws CantOpen if the key, id or kind is
 * wrong, or it was changed.
 * @param {{ id: string, kind: ShareKind, key: Uint8Array<ArrayBuffer>, sealed: Uint8Array<ArrayBuffer> }} share
 * @returns {Promise<unknown>}
 */
export async function openSnapshot({ id, kind, key, sealed }) {
  if (!SHARE_KINDS.includes(kind) || sealed.length < 28) throw new CantOpen();
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.subarray(0, 12), additionalData: additionalData(id, kind) },
      await snapshotKey(key, "decrypt"),
      sealed.subarray(12)
    );
  } catch {
    throw new CantOpen();
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * What a share's file is bound to (see media.js's Binding).
 * @param {string} shareId
 * @param {string} fileId
 * @returns {import("./media.js").Binding}
 */
function fileBinding(shareId, fileId) {
  const base = `notonawa|share|v${SHARE_VERSION}|${shareId}|file|${fileId}`;
  return {
    part: (part) => `${base}|${part}`,
    piece: (n, last) => `${base}|full|${n}|${last ? "last" : "more"}`,
  };
}

/**
 * Seals a photo or video for a share, as the object to upload.
 * @param {{
 *   shareId: string, fileId: string, key: Uint8Array<ArrayBuffer>, video: boolean, thumb: ArrayBuffer, full: ArrayBuffer,
 * }} file
 * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
 */
export async function sealShareFile({ shareId, fileId, key, video, thumb, full }) {
  return sealObject(await derivedKey(key, "file", "encrypt"), fileBinding(shareId, fileId), { thumb, full, video });
}

/**
 * Opens one part of a share's photo or video. Throws CantOpen if the key,
 * share, file or part is wrong, or it was changed.
 * @param {{
 *   shareId: string, fileId: string, key: Uint8Array<ArrayBuffer>, video: boolean, part: "thumb" | "full", sealed: ArrayBuffer,
 * }} file
 * @returns {Promise<ArrayBuffer>}
 */
export async function openShareFile({ shareId, fileId, key, video, part, sealed }) {
  return openObjectPart(await derivedKey(key, "file", "decrypt"), fileBinding(shareId, fileId), { part, video }, sealed);
}

/**
 * The part of a share's link after "#".
 * @param {string} id
 * @param {Uint8Array} key
 */
export function shareFragment(id, key) {
  return `${id}.${toBase64url(key)}`;
}

/**
 * A share's id and key from a link's "#…", or null if it isn't one.
 * @param {string} hash location.hash, with or without its "#"
 * @returns {{ id: string, key: Uint8Array<ArrayBuffer> } | null}
 */
export function readShareFragment(hash) {
  const match = hash.match(FRAGMENT);
  if (!match) return null;
  const key = fromBase64url(match[2]);
  return key.length === 32 ? { id: match[1], key } : null;
}
