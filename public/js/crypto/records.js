// Sealed records (format 2): one per item, holding all its fields and
// links. Pure apart from WebCrypto, so it's easy to test; used by the crypto
// Worker (vault-core.js), which holds the data key.
//
// Each record has its own random item key (AES-256), sealed under the data
// key and stored beside the record ("k2.<iv>.<ciphertext>"). The record's
// body is its fields as JSON ({ v: 2, ... }), padded with spaces to a
// multiple of 256 bytes so its size says less about what's in it, and sealed
// under the item key ("e2.<iv>.<ciphertext>"). Both are AES-256-GCM with a
// random 12-byte IV, and bound by their additional data:
//
//   item key: notonawa|itemkey|v2|<user>|<kind>|<id>
//   body:     notonawa|record|v2|<user>|<kind>|<id>|<version>
//
// so the server can't move a body or key to another record, kind or user,
// or pair an older body with a newer version number.

import { toBase64url, fromBase64url } from "./keys.js";
import { CantOpen } from "./fields.js";

/** The kinds of record. */
export const RECORD_KINDS = /** @type {const} */ ([
  "tie", "plan", "person", "location", "workshop", "tag", "drawing", "pose", "pose_preset", "settings", "contact",
]);
/** @typedef {typeof RECORD_KINDS[number]} RecordKind */

/**
 * Where a record is: whose, what kind, which one. Its version too, for its
 * body.
 * @typedef {{ userId: string, kind: RecordKind, id: string }} RecordPlace
 * @typedef {RecordPlace & { version: number }} RecordVersion
 */

/** Bodies are padded to a multiple of this many bytes. */
export const PAD_BYTES = 256;
/**
 * The largest body, padded, before sealing: sealed and in base64url it's
 * about 1.4 MB, under the server's cap and D1's 2 MB row.
 */
export const MAX_BODY_BYTES = 1024 * 1024;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SPACE = 0x20;

const encode = (/** @type {string} */ text) => /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(text));

/** @param {RecordPlace} where */
export function itemKeyData({ userId, kind, id }) {
  return `notonawa|itemkey|v2|${userId}|${kind}|${id}`;
}

/** @param {RecordVersion} where */
export function bodyData({ userId, kind, id, version }) {
  return `notonawa|record|v2|${userId}|${kind}|${id}|${version}`;
}

/** @param {RecordPlace} where */
function checkPlace({ userId, kind, id }) {
  if (!userId || !id) throw new Error("A record needs its user and id.");
  if (!RECORD_KINDS.includes(kind)) throw new Error(`Not a kind of record: ${kind}`);
}

/**
 * "<prefix>.<iv>.<ciphertext>", all base64url.
 * @param {string} prefix
 * @param {Uint8Array} iv
 * @param {ArrayBuffer} sealed
 */
const join = (prefix, iv, sealed) => `${prefix}.${toBase64url(iv)}.${toBase64url(sealed)}`;

/**
 * @param {string} prefix
 * @param {unknown} value
 * @returns {{ iv: Uint8Array<ArrayBuffer>, sealed: Uint8Array<ArrayBuffer> }}
 */
function split(prefix, value) {
  const parts = typeof value === "string" ? value.split(".") : [];
  if (parts.length !== 3 || parts[0] !== prefix) throw new CantOpen();
  try {
    const iv = fromBase64url(parts[1]);
    const sealed = fromBase64url(parts[2]);
    if (iv.length !== IV_BYTES || sealed.length < 16) throw new CantOpen();
    return { iv, sealed };
  } catch {
    throw new CantOpen();
  }
}

/**
 * A new item key, and its sealed copy for the record's row. The key is
 * non-extractable: only its sealed copy leaves the Worker.
 * @param {CryptoKey} dataKey
 * @param {RecordPlace} where
 * @param {{ raw?: Uint8Array<ArrayBuffer>, iv?: Uint8Array<ArrayBuffer> }} [fixed] for tests only
 * @returns {Promise<{ key: CryptoKey, sealed: string }>}
 */
export async function newItemKey(dataKey, where, fixed = {}) {
  checkPlace(where);
  const raw = fixed.raw ?? crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const iv = fixed.iv ?? crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encode(itemKeyData(where)) }, dataKey, raw);
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  if (!fixed.raw) raw.fill(0);
  return { key, sealed: join("k2", iv, sealed) };
}

/**
 * Opens a record's item key. Throws CantOpen if it isn't this record's.
 * @param {CryptoKey} dataKey
 * @param {RecordPlace} where
 * @param {unknown} sealed "k2.<iv>.<ciphertext>"
 * @returns {Promise<CryptoKey>} non-extractable
 */
export async function openItemKey(dataKey, where, sealed) {
  checkPlace(where);
  const { iv, sealed: bytes } = split("k2", sealed);
  /** @type {Uint8Array<ArrayBuffer>} */
  let raw;
  try {
    raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: encode(itemKeyData(where)) }, dataKey, bytes));
  } catch {
    throw new CantOpen();
  }
  if (raw.length !== KEY_BYTES) throw new CantOpen();
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  raw.fill(0);
  return key;
}

/**
 * Pads JSON text with spaces to a multiple of PAD_BYTES (JSON.parse ignores
 * them, so nothing needs taking off).
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function pad(bytes) {
  const length = Math.max(PAD_BYTES, Math.ceil(bytes.length / PAD_BYTES) * PAD_BYTES);
  const out = new Uint8Array(length).fill(SPACE);
  out.set(bytes);
  return out;
}

/** A record's body is too big to keep as one record. */
export class TooBig extends Error {
  constructor() {
    super("This entry has too much in it to save.");
    this.name = "TooBig";
  }
}

/**
 * Seals a record's body under its item key.
 * @param {CryptoKey} itemKey
 * @param {RecordVersion} where
 * @param {Record<string, unknown>} fields everything but v (set here)
 * @param {{ iv?: Uint8Array<ArrayBuffer> }} [fixed] for tests only
 * @returns {Promise<string>} "e2.<iv>.<ciphertext>"
 */
export async function sealBody(itemKey, where, fields, fixed = {}) {
  checkPlace(where);
  if (!Number.isInteger(where.version) || where.version < 1) throw new Error("A record's version starts at 1.");
  const { v: _v, ...rest } = fields;
  const padded = pad(encode(JSON.stringify({ v: 2, ...rest })));
  if (padded.length > MAX_BODY_BYTES) throw new TooBig();
  const iv = fixed.iv ?? crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encode(bodyData(where)) }, itemKey, padded);
  return join("e2", iv, sealed);
}

/**
 * Opens a record's body. Throws CantOpen if it isn't this record's, at this
 * version, or isn't a format 2 body.
 * @param {CryptoKey} itemKey
 * @param {RecordVersion} where
 * @param {unknown} sealed "e2.<iv>.<ciphertext>"
 * @returns {Promise<Record<string, unknown> & { v: 2 }>}
 */
export async function openBody(itemKey, where, sealed) {
  checkPlace(where);
  const { iv, sealed: bytes } = split("e2", sealed);
  /** @type {unknown} */
  let body;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: encode(bodyData(where)) }, itemKey, bytes);
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(plain));
  } catch {
    throw new CantOpen();
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || /** @type {any} */ (body).v !== 2) throw new CantOpen();
  return /** @type {Record<string, unknown> & { v: 2 }} */ (body);
}
