// Encrypted text fields: the notes and descriptions only the user can read.
// Pure apart from WebCrypto, so it's easy to test; used by the crypto
// Worker (vault-core.js), which holds the key.
//
// A field is stored as "e1.<iv>.<ciphertext>" (base64url) in its usual
// column, AES-256-GCM with the data key. The additional data binds it to the
// user, the table and the field, so the server can't pass notes off as
// another user's, or move a description into notes. (Not to the row: the
// server could swap two of the same user's notes. Binding to the row would
// need the browser to choose every new row's id, imports included.)
//
// Text is trimmed before it's sealed, and empty text is stored as null, as
// the server did with plain text (cleanText), so comparing opened notes
// with typed ones (import's duplicate check) works the same.

import { toBase64url, fromBase64url } from "./keys.js";

/**
 * Each kind of record, its table, and its encrypted fields. The same list as
 * ENCRYPTED_COLUMNS in src/encryption/config.js.
 */
export const ENCRYPTED = /** @type {const} */ ({
  tie: { table: "ties", fields: ["notes", "album_url"] },
  participant: { table: "tie_participants", fields: ["notes"] },
  person: { table: "people", fields: ["notes", "based_in", "aliases", "about"] },
  profileNote: { table: "profile_notes", fields: ["description"] },
  location: { table: "locations", fields: ["notes"] },
  plan: { table: "plans", fields: ["description", "notes", "album_url"] },
  workshop: { table: "workshops", fields: ["description", "notes", "album_url", "cost", "event_url"] },
  drawing: { table: "drawings", fields: ["caption"] },
  pose: { table: "poses", fields: ["caption"] },
  // A saved poser preset's name (src/pose-presets/).
  posePreset: { table: "pose_presets", fields: ["name"] },
  // The sender's own name for a share (src/shares/), and its link's key,
  // so they can show its code again.
  share: { table: "shares", fields: ["label", "link_key"] },
  // My name for a connection (src/connections/): the name a profile was
  // shared as, on the side that accepted it. (The inviter's side holds the
  // invite's own label, sealed as a share's: open it as "share".)
  connection: { table: "connections", fields: ["label"] },
});

/** @typedef {keyof typeof ENCRYPTED} RecordKind */

// The same pattern as src/parse.js's encryptedText checks (a unit test keeps
// them in step): "e1.", a 12-byte IV, ".", and at least the 16-byte tag.
const FORMAT = /^e1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/;
// The longest sealed field the server accepts (about 74,000 characters of
// plain text: far more than a note needs).
export const MAX_SEALED_LENGTH = 100_000;

/**
 * Whether a stored value is sealed (rather than plain text from before
 * encryption, which the app opens as it is until it's encrypted).
 * @param {unknown} value
 */
export function isSealed(value) {
  return typeof value === "string" && FORMAT.test(value);
}

const encode = (/** @type {string} */ text) => /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(text));

/**
 * @param {string} userId
 * @param {string} table
 * @param {string} field
 */
function additionalData(userId, table, field) {
  return encode(`notonawa|field|v1|${userId}|${table}.${field}`);
}

/**
 * Seals one field's text. null for empty text.
 * @param {CryptoKey} key
 * @param {{ userId: string, table: string, field: string }} where
 * @param {unknown} text
 * @returns {Promise<string | null>}
 */
export async function sealText(key, { userId, table, field }, text) {
  if (text === null || text === undefined) return null;
  const trimmed = String(text).trim();
  if (trimmed === "") return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(userId, table, field) }, key, encode(trimmed)
  );
  const value = `e1.${toBase64url(iv)}.${toBase64url(sealed)}`;
  if (value.length > MAX_SEALED_LENGTH) throw new TooLong();
  return value;
}

/**
 * Opens one field. Plain text (from before encryption) is returned as it
 * is. Throws CantOpen if it's sealed but won't open.
 * @param {CryptoKey} key
 * @param {{ userId: string, table: string, field: string }} where
 * @param {unknown} value
 * @returns {Promise<string | null>}
 */
export async function openText(key, { userId, table, field }, value) {
  if (value === null || value === undefined) return null;
  if (!isSealed(value)) return String(value);
  const [, iv, sealed] = String(value).split(".");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64url(iv), additionalData: additionalData(userId, table, field) },
      key, fromBase64url(sealed)
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new CantOpen();
  }
}

/**
 * A copy of a record with its kind's encrypted fields sealed. Values that
 * are already sealed are kept as they are.
 * @template {Record<string, any>} T
 * @param {CryptoKey} key
 * @param {string} userId
 * @param {RecordKind} kind
 * @param {T} record
 * @returns {Promise<T>}
 */
export async function sealRecord(key, userId, kind, record) {
  const { table, fields } = ENCRYPTED[kind];
  /** @type {Record<string, any>} */
  const out = { ...record };
  for (const field of fields) {
    if (!(field in record) || isSealed(record[field])) continue;
    out[field] = await sealText(key, { userId, table, field }, record[field]);
  }
  return /** @type {T} */ (out);
}

/**
 * A copy of a record with its kind's encrypted fields opened. A field that
 * won't open becomes null, and is listed in `unreadable`.
 * @template {Record<string, any>} T
 * @param {CryptoKey} key
 * @param {string} userId
 * @param {RecordKind} kind
 * @param {T} record
 * @returns {Promise<T & { unreadable?: string[] }>}
 */
export async function openRecord(key, userId, kind, record) {
  const { table, fields } = ENCRYPTED[kind];
  /** @type {Record<string, any>} */
  const out = { ...record };
  /** @type {string[]} */
  const unreadable = [];
  for (const field of fields) {
    if (!(field in record)) continue;
    try {
      out[field] = await openText(key, { userId, table, field }, record[field]);
    } catch {
      out[field] = null;
      unreadable.push(field);
    }
  }
  if (unreadable.length) out.unreadable = unreadable;
  return /** @type {T & { unreadable?: string[] }} */ (out);
}

/** A sealed field that won't open (made with another key, or tampered with). */
export class CantOpen extends Error {
  constructor() {
    super("Can't decrypt this.");
    this.name = "CantOpen";
  }
}

/** A field too long to save. */
export class TooLong extends Error {
  constructor() {
    super("That's too long to save. Shorten the notes, please.");
    this.name = "TooLong";
  }
}
