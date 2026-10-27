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
 * What a photo's or video's sealed parts are bound to: the additional data
 * for its thumbnail, full size or caption, and for each piece of a video's
 * full size. My own photos are bound to me and their id (mediaBinding);
 * a share's to the share and the file's id (crypto/share.js).
 * @typedef {{ part: (part: MediaPart) => string, piece: (n: number, last: boolean) => string }} Binding
 */

/**
 * My own photo's or video's binding.
 * @param {string} userId
 * @param {string} mediaId
 * @returns {Binding}
 */
export function mediaBinding(userId, mediaId) {
  return {
    part: (part) => `notonawa|media|v1|${userId}|${mediaId}|${part}`,
    piece: (n, last) => `notonawa|media|v2|${userId}|${mediaId}|full|${n}|${last ? "last" : "more"}`,
  };
}

const encode = (/** @type {string} */ text) => new TextEncoder().encode(text);

/**
 * Seals a full size in pieces: each a 12-byte IV and its ciphertext, one
 * after another.
 * @param {CryptoKey} key
 * @param {Binding} binding
 * @param {ArrayBuffer} bytes
 * @param {number} pieceBytes
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
async function sealPiecesBound(key, binding, bytes, pieceBytes) {
  const count = Math.max(1, Math.ceil(bytes.byteLength / pieceBytes));
  const out = new Uint8Array(bytes.byteLength + count * (IV_BYTES + TAG_BYTES));
  let at = 0;
  for (let n = 0; n < count; n++) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encode(binding.piece(n, n === count - 1)) },
      key, bytes.slice(n * pieceBytes, (n + 1) * pieceBytes)
    );
    out.set(iv, at);
    out.set(new Uint8Array(sealed), at + IV_BYTES);
    at += IV_BYTES + sealed.byteLength;
  }
  return out;
}

/**
 * Opens a full size sealed in pieces. Throws CantOpen if any piece won't
 * open, or one is missing.
 * @param {CryptoKey} key
 * @param {Binding} binding
 * @param {ArrayBuffer} sealed
 * @param {number} pieceBytes
 * @returns {Promise<ArrayBuffer>}
 */
async function openPiecesBound(key, binding, sealed, pieceBytes) {
  const sealedPiece = IV_BYTES + pieceBytes + TAG_BYTES;
  const count = Math.ceil(sealed.byteLength / sealedPiece);
  const lastSize = sealed.byteLength - (count - 1) * sealedPiece;
  if (count === 0 || lastSize < IV_BYTES + TAG_BYTES) throw new CantOpen();
  const out = new Uint8Array(sealed.byteLength - count * (IV_BYTES + TAG_BYTES));
  for (let n = 0; n < count; n++) {
    const piece = sealed.slice(n * sealedPiece, (n + 1) * sealedPiece);
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: piece.slice(0, IV_BYTES), additionalData: encode(binding.piece(n, n === count - 1)) },
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
 * Seals one part whole: the IV, then the ciphertext.
 * @param {CryptoKey} key
 * @param {string} additionalData
 * @param {ArrayBuffer} bytes
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
async function sealBound(key, additionalData, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encode(additionalData) }, key, bytes);
  const out = new Uint8Array(IV_BYTES + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), IV_BYTES);
  return out;
}

/**
 * Opens one part sealed whole. Throws CantOpen if it won't.
 * @param {CryptoKey} key
 * @param {string} additionalData
 * @param {ArrayBuffer} sealed
 * @returns {Promise<ArrayBuffer>}
 */
async function openBound(key, additionalData, sealed) {
  try {
    return await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.slice(0, IV_BYTES), additionalData: encode(additionalData) }, key, sealed.slice(IV_BYTES)
    );
  } catch {
    throw new CantOpen();
  }
}

/**
 * Seals a photo or video into the object that's uploaded: its thumbnail,
 * then its full size (a video's in pieces).
 * @param {CryptoKey} key
 * @param {Binding} binding
 * @param {{ thumb: ArrayBuffer, full: ArrayBuffer, video: boolean }} file
 * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
 */
export async function sealObject(key, binding, { thumb, full, video }) {
  const sealedThumb = await sealBound(key, binding.part("thumb"), thumb);
  const sealedFull = video ? await sealPiecesBound(key, binding, full, PIECE_BYTES) : await sealBound(key, binding.part("full"), full);
  const body = new Uint8Array(sealedThumb.length + sealedFull.length);
  body.set(sealedThumb);
  body.set(sealedFull, sealedThumb.length);
  return { body: body.buffer, thumbBytes: sealedThumb.length };
}

/**
 * Opens one part of an object sealObject made. Throws CantOpen if it won't.
 * @param {CryptoKey} key
 * @param {Binding} binding
 * @param {{ part: "thumb" | "full", video: boolean }} which
 * @param {ArrayBuffer} sealed
 * @returns {Promise<ArrayBuffer>}
 */
export function openObjectPart(key, binding, { part, video }, sealed) {
  return video && part === "full"
    ? openPiecesBound(key, binding, sealed, PIECE_BYTES)
    : openBound(key, binding.part(part), sealed);
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
export function sealPieces(key, { userId, mediaId }, bytes, pieceBytes = PIECE_BYTES) {
  return sealPiecesBound(key, mediaBinding(userId, mediaId), bytes, pieceBytes);
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
export function openPieces(key, { userId, mediaId }, sealed, pieceBytes = PIECE_BYTES) {
  return openPiecesBound(key, mediaBinding(userId, mediaId), sealed, pieceBytes);
}

/**
 * Seals one part of a photo.
 * @param {CryptoKey} key
 * @param {{ userId: string, mediaId: string, part: "thumb" | "full" }} where
 * @param {ArrayBuffer} bytes
 * @returns {Promise<Uint8Array<ArrayBuffer>>} the IV, then the ciphertext
 */
export function sealPart(key, { userId, mediaId, part }, bytes) {
  return sealBound(key, mediaBinding(userId, mediaId).part(part), bytes);
}

/**
 * Opens one part of a photo. Throws CantOpen if it won't.
 * @param {CryptoKey} key
 * @param {{ userId: string, mediaId: string, part: "thumb" | "full" }} where
 * @param {ArrayBuffer} sealed
 * @returns {Promise<ArrayBuffer>}
 */
export function openPart(key, { userId, mediaId, part }, sealed) {
  return openBound(key, mediaBinding(userId, mediaId).part(part), sealed);
}

/**
 * Seals a photo's thumbnail and full size into the object that's uploaded.
 * @param {CryptoKey} key
 * @param {{ userId: string, mediaId: string }} where
 * @param {{ thumb: ArrayBuffer, full: ArrayBuffer }} photo
 * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
 */
export function sealPhoto(key, { userId, mediaId }, { thumb, full }) {
  return sealObject(key, mediaBinding(userId, mediaId), { thumb, full, video: false });
}

/**
 * Seals a video's thumbnail and full size (in pieces) into the object
 * that's uploaded.
 * @param {CryptoKey} key
 * @param {{ userId: string, mediaId: string }} where
 * @param {{ thumb: ArrayBuffer, full: ArrayBuffer }} video
 * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
 */
export function sealVideo(key, { userId, mediaId }, { thumb, full }) {
  return sealObject(key, mediaBinding(userId, mediaId), { thumb, full, video: true });
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
    { name: "AES-GCM", iv, additionalData: encode(mediaBinding(userId, mediaId).part("caption")) },
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
      { name: "AES-GCM", iv: fromBase64url(iv), additionalData: encode(mediaBinding(userId, mediaId).part("caption")) },
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
