// Sealed photos and videos (format v3, with records). Pure apart from
// WebCrypto, so it's easy to test; used by the crypto Worker (vault-core.js).
//
// Each file has its own random key (AES-256), kept only in its item's
// record (as base64url, in the visual's entry), never on the server, so
// sharing an item can hand over its files' keys without anything else.
//
// A file is uploaded as one object: its sealed thumbnail, then its sealed
// full size (thumb_bytes says where one ends). A cover crop, when it comes,
// is a part of its own. Every part, of a photo or a video alike, is sealed
// in pieces of PIECE_BYTES (a thumbnail is one piece): each a 12-byte IV and
// its AES-256-GCM ciphertext and tag, bound by its additional data
//
//   notonawa|file|v3|<user>|<file id>|<part>|<piece number>|last or more
//
// so the server can't pass one file or part off as another, reorder pieces,
// or cut a part short (the last piece only opens as the last).

import { toBase64url, fromBase64url } from "./keys.js";
import { CantOpen } from "./fields.js";

/** @typedef {"thumb" | "full" | "cover"} FilePart */
/** @typedef {{ userId: string, fileId: string }} FilePlace */

/** Parts are sealed in pieces this big (the last can be smaller). */
export const PIECE_BYTES = 1024 * 1024;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const PARTS = /** @type {const} */ (["thumb", "full", "cover"]);

const encode = (/** @type {string} */ text) => /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(text));

/**
 * @param {FilePlace & { part: FilePart }} where
 * @param {number} n
 * @param {boolean} last
 */
export function pieceData({ userId, fileId, part }, n, last) {
  return `notonawa|file|v3|${userId}|${fileId}|${part}|${n}|${last ? "last" : "more"}`;
}

/** @param {FilePlace & { part: FilePart }} where */
function check({ userId, fileId, part }) {
  if (!userId || !fileId) throw new Error("A file needs its user and id.");
  if (!PARTS.includes(part)) throw new Error(`Not a part of a file: ${part}`);
}

/**
 * A new file key, as kept in its item's record.
 * @returns {string} base64url, 32 bytes
 */
export function newFileKey() {
  const raw = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const text = toBase64url(raw);
  raw.fill(0);
  return text;
}

/**
 * A file key, from its record, ready to use (non-extractable).
 * @param {unknown} text base64url
 * @returns {Promise<CryptoKey>}
 */
export async function fileKey(text) {
  /** @type {Uint8Array<ArrayBuffer>} */
  let raw;
  try {
    raw = fromBase64url(/** @type {string} */ (text));
  } catch {
    throw new CantOpen();
  }
  if (typeof text !== "string" || raw.length !== KEY_BYTES) throw new CantOpen();
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  raw.fill(0);
  return key;
}

/**
 * Seals one part in pieces, one after another.
 * @param {CryptoKey} key
 * @param {FilePlace & { part: FilePart }} where
 * @param {ArrayBuffer | Uint8Array} bytes
 * @param {{ pieceBytes?: number, iv?: (n: number) => Uint8Array<ArrayBuffer> }} [options] for tests only
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function sealPart(key, where, bytes, { pieceBytes = PIECE_BYTES, iv = () => crypto.getRandomValues(new Uint8Array(IV_BYTES)) } = {}) {
  check(where);
  const plain = new Uint8Array(bytes);
  const count = Math.max(1, Math.ceil(plain.length / pieceBytes));
  const out = new Uint8Array(plain.length + count * (IV_BYTES + TAG_BYTES));
  let at = 0;
  for (let n = 0; n < count; n++) {
    const pieceIv = iv(n);
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: pieceIv, additionalData: encode(pieceData(where, n, n === count - 1)) },
      key, plain.slice(n * pieceBytes, (n + 1) * pieceBytes),
    );
    out.set(pieceIv, at);
    out.set(new Uint8Array(sealed), at + IV_BYTES);
    at += IV_BYTES + sealed.byteLength;
  }
  return out;
}

/**
 * Opens one part. Throws CantOpen if any piece won't open, or is missing,
 * moved or added.
 * @param {CryptoKey} key
 * @param {FilePlace & { part: FilePart }} where
 * @param {ArrayBuffer | Uint8Array} sealed
 * @param {{ pieceBytes?: number }} [options] for tests only
 * @returns {Promise<ArrayBuffer>}
 */
export async function openPart(key, where, sealed, { pieceBytes = PIECE_BYTES } = {}) {
  check(where);
  const bytes = new Uint8Array(sealed);
  const sealedPiece = IV_BYTES + pieceBytes + TAG_BYTES;
  const count = Math.ceil(bytes.length / sealedPiece);
  const lastSize = bytes.length - (count - 1) * sealedPiece;
  if (count === 0 || lastSize < IV_BYTES + TAG_BYTES) throw new CantOpen();
  const out = new Uint8Array(bytes.length - count * (IV_BYTES + TAG_BYTES));
  for (let n = 0; n < count; n++) {
    const piece = bytes.slice(n * sealedPiece, (n + 1) * sealedPiece);
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: piece.slice(0, IV_BYTES), additionalData: encode(pieceData(where, n, n === count - 1)) },
        key, piece.slice(IV_BYTES),
      );
      out.set(new Uint8Array(plain), n * pieceBytes);
    } catch {
      throw new CantOpen();
    }
  }
  return out.buffer;
}

/**
 * Seals a photo or video into the object that's uploaded: its thumbnail,
 * then its full size.
 * @param {CryptoKey} key
 * @param {FilePlace} where
 * @param {{ thumb: ArrayBuffer, full: ArrayBuffer }} file
 * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
 */
export async function sealFile(key, where, { thumb, full }) {
  const sealedThumb = await sealPart(key, { ...where, part: "thumb" }, thumb);
  const sealedFull = await sealPart(key, { ...where, part: "full" }, full);
  const body = new Uint8Array(sealedThumb.length + sealedFull.length);
  body.set(sealedThumb);
  body.set(sealedFull, sealedThumb.length);
  return { body: body.buffer, thumbBytes: sealedThumb.length };
}
