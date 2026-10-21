// Sealed photos, videos and their captions. Pure apart from WebCrypto, so it's easy
// to test; used by the crypto Worker (vault-core.js), which holds the key.
//
// A photo is uploaded as one object: its sealed thumbnail, then its sealed
// full size. Each part is a 12-byte IV followed by the AES-256-GCM
// ciphertext (with its tag). The additional data binds each part to the
// user, the photo's id (made in the browser) and which part it is, so the
// server can't pass one photo off as another, or a thumbnail as a full size.
//
// A caption is sealed like a notes field ("e1.<iv>.<ciphertext>", so the
// server checks it the same way), but bound to its photo's id too.
//
// A video is uploaded the same way, its thumbnail sealed like a photo's,
// but its full size (up to about 40 MB) is sealed in pieces of PIECE_BYTES,
// each with its own IV. A piece's additional data (format v2) also holds
// its number and whether it's the last, so the server can't reorder the
// pieces, swap in another video's, or cut a video short: the last piece
// only opens as the last.

import { toBase64url, fromBase64url } from "./keys.js";
import { isSealed, CantOpen } from "./fields.js";

/** @typedef {"thumb" | "full" | "caption"} MediaPart */

/** The longest caption, in characters. */
export const MAX_CAPTION = 200;

const IV_BYTES = 12;
const TAG_BYTES = 16;
/** A video's full size is sealed in pieces this big (the last can be smaller). */
export const PIECE_BYTES = 1024 * 1024;

/**
 * @param {string} userId
 * @param {string} mediaId
 * @param {MediaPart} part
 */
function additionalData(userId, mediaId, part) {
  return new TextEncoder().encode(`notonawa|media|v1|${userId}|${mediaId}|${part}`);
}

/**
 * @param {string} userId
 * @param {string} mediaId
 * @param {number} piece counted from 0
 * @param {boolean} last
 */
function pieceData(userId, mediaId, piece, last) {
  return new TextEncoder().encode(`notonawa|media|v2|${userId}|${mediaId}|full|${piece}|${last ? "last" : "more"}`);
}

/**
 * Seals a video's full size in pieces: each a 12-byte IV and its
 * ciphertext, one after another.
 * @param {CryptoKey} key
 * @param {{ userId: string, mediaId: string }} where
 * @param {ArrayBuffer} bytes
 * @param {number} [pieceBytes] only changed by tests
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function sealPieces(key, { userId, mediaId }, bytes, pieceBytes = PIECE_BYTES) {
  const count = Math.max(1, Math.ceil(bytes.byteLength / pieceBytes));
  const out = new Uint8Array(bytes.byteLength + count * (IV_BYTES + TAG_BYTES));
  let at = 0;
  for (let n = 0; n < count; n++) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: pieceData(userId, mediaId, n, n === count - 1) },
      key, bytes.slice(n * pieceBytes, (n + 1) * pieceBytes)
    );
    out.set(iv, at);
    out.set(new Uint8Array(sealed), at + IV_BYTES);
    at += IV_BYTES + sealed.byteLength;
  }
  return out;
}

/**
 * Opens a video's full size sealed by sealPieces. Throws CantOpen if any
 * piece won't open, or one is missing.
 * @param {CryptoKey} key
 * @param {{ userId: string, mediaId: string }} where
 * @param {ArrayBuffer} sealed
 * @param {number} [pieceBytes] only changed by tests
 * @returns {Promise<ArrayBuffer>}
 */
export async function openPieces(key, { userId, mediaId }, sealed, pieceBytes = PIECE_BYTES) {
  const sealedPiece = IV_BYTES + pieceBytes + TAG_BYTES;
  const count = Math.ceil(sealed.byteLength / sealedPiece);
  const lastSize = sealed.byteLength - (count - 1) * sealedPiece;
  if (count === 0 || lastSize < IV_BYTES + TAG_BYTES) throw new CantOpen();
  const out = new Uint8Array(sealed.byteLength - count * (IV_BYTES + TAG_BYTES));
  for (let n = 0; n < count; n++) {
    const piece = sealed.slice(n * sealedPiece, (n + 1) * sealedPiece);
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: piece.slice(0, IV_BYTES), additionalData: pieceData(userId, mediaId, n, n === count - 1) },
        key, piece.slice(IV_BYTES)
      );
      out.set(new Uint8Array(plain), n * pieceBytes);
    } catch {
      throw new CantOpen();
    }
  }
  return out.buffer;
}

/**
 * Seals one part of a photo.
 * @param {CryptoKey} key
 * @param {{ userId: string, mediaId: string, part: "thumb" | "full" }} where
 * @param {ArrayBuffer} bytes
 * @returns {Promise<Uint8Array<ArrayBuffer>>} the IV, then the ciphertext
 */
export async function sealPart(key, { userId, mediaId, part }, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(userId, mediaId, part) }, key, bytes
  );
  const out = new Uint8Array(IV_BYTES + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), IV_BYTES);
  return out;
}

/**
 * Opens one part of a photo. Throws CantOpen if it won't.
 * @param {CryptoKey} key
 * @param {{ userId: string, mediaId: string, part: "thumb" | "full" }} where
 * @param {ArrayBuffer} sealed
 * @returns {Promise<ArrayBuffer>}
 */
export async function openPart(key, { userId, mediaId, part }, sealed) {
  try {
    return await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.slice(0, IV_BYTES), additionalData: additionalData(userId, mediaId, part) },
      key, sealed.slice(IV_BYTES)
    );
  } catch {
    throw new CantOpen();
  }
}

/**
 * Seals a photo's thumbnail and full size into the object that's uploaded.
 * @param {CryptoKey} key
 * @param {{ userId: string, mediaId: string }} where
 * @param {{ thumb: ArrayBuffer, full: ArrayBuffer }} photo
 * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
 */
export async function sealPhoto(key, { userId, mediaId }, { thumb, full }) {
  const sealedThumb = await sealPart(key, { userId, mediaId, part: "thumb" }, thumb);
  const sealedFull = await sealPart(key, { userId, mediaId, part: "full" }, full);
  const body = new Uint8Array(sealedThumb.length + sealedFull.length);
  body.set(sealedThumb);
  body.set(sealedFull, sealedThumb.length);
  return { body: body.buffer, thumbBytes: sealedThumb.length };
}

/**
 * Seals a video's thumbnail and full size (in pieces) into the object
 * that's uploaded.
 * @param {CryptoKey} key
 * @param {{ userId: string, mediaId: string }} where
 * @param {{ thumb: ArrayBuffer, full: ArrayBuffer }} video
 * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
 */
export async function sealVideo(key, { userId, mediaId }, { thumb, full }) {
  const sealedThumb = await sealPart(key, { userId, mediaId, part: "thumb" }, thumb);
  const sealedFull = await sealPieces(key, { userId, mediaId }, full);
  const body = new Uint8Array(sealedThumb.length + sealedFull.length);
  body.set(sealedThumb);
  body.set(sealedFull, sealedThumb.length);
  return { body: body.buffer, thumbBytes: sealedThumb.length };
}

/**
 * Seals a caption, bound to its photo. null for an empty one.
 * @param {CryptoKey} key
 * @param {{ userId: string, mediaId: string }} where
 * @param {unknown} text
 * @returns {Promise<string | null>}
 */
export async function sealCaption(key, { userId, mediaId }, text) {
  if (text === null || text === undefined) return null;
  const trimmed = String(text).trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_CAPTION) throw new CaptionTooLong();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(userId, mediaId, "caption") },
    key, new TextEncoder().encode(trimmed)
  );
  return `e1.${toBase64url(iv)}.${toBase64url(sealed)}`;
}

/**
 * Opens a caption. Throws CantOpen if it's not sealed for this photo.
 * @param {CryptoKey} key
 * @param {{ userId: string, mediaId: string }} where
 * @param {unknown} value
 * @returns {Promise<string | null>}
 */
export async function openCaption(key, { userId, mediaId }, value) {
  if (value === null || value === undefined) return null;
  if (!isSealed(value)) throw new CantOpen();
  const [, iv, sealed] = String(value).split(".");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64url(iv), additionalData: additionalData(userId, mediaId, "caption") },
      key, fromBase64url(sealed)
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new CantOpen();
  }
}

/** A caption over MAX_CAPTION characters. */
export class CaptionTooLong extends Error {
  constructor() {
    super(`A caption can be up to ${MAX_CAPTION} characters.`);
    this.name = "CaptionTooLong";
  }
}
