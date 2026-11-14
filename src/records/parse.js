// Sealed records (format 2): checking what a device sends. The server never
// reads a record's body or key, only their shape and size. Pure, so it's
// easy to test.

import { BadInput } from "../http.js";

/** The kinds of record, as public/js/crypto/records.js's RECORD_KINDS (a unit test keeps them in step). */
export const KINDS = /** @type {const} */ ([
  "tie", "plan", "person", "location", "workshop", "tag", "drawing", "pose", "pose_preset", "settings", "contact",
]);
/** @typedef {typeof KINDS[number]} Kind */

/** Writes and deletes in one batch: one D1 batch, all or nothing. */
export const MAX_BATCH = 50;
/** Records and deletion markers in a sync page, at most. */
export const PAGE_ROWS = 500;
/** And their bodies' bytes, about: a page stops after the record that passes this. */
export const PAGE_BYTES = 8 * 1024 * 1024;
/** A sealed body: the device's 1 MiB padded, sealed, in base64url, with room. */
export const MAX_BODY = 1_500_000;
/** File ids one delete frees, at most. */
export const MAX_FILES_FREED = 10_000;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
// "k2.", a 12-byte IV, ".", a sealed 32-byte key with its tag (48 bytes).
const KEY = /^k2\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$/;
// "e2.", a 12-byte IV, ".", at least a padded 256-byte body and its tag.
const BODY = /^e2\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{363,}$/;

/**
 * @typedef {{ op: "write", id: string, kind: Kind, base_version: number, version: number, key: string, body: string }} Write
 * @typedef {{ op: "delete", id: string, kind: Kind, base_version: number, files: string[] }} Delete
 */

/**
 * @param {unknown} value
 * @param {string} what
 */
export function parseId(value, what = "id") {
  if (typeof value !== "string" || !ID.test(value)) throw new BadInput(`That isn't a record's ${what}.`);
  return value;
}

/** @param {unknown} value */
function parseKind(value) {
  if (!KINDS.includes(/** @type {Kind} */ (value))) throw new BadInput("That isn't a kind of record.");
  return /** @type {Kind} */ (value);
}

/** @param {unknown} value */
function parseBase(value) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 0) throw new BadInput("Say which version the change is based on.");
  return /** @type {number} */ (value);
}

/**
 * A batch of writes and deletes. Each write: { id, kind, base_version (0
 * for a new record), key, body }; each delete: { id, kind, base_version,
 * files: the file ids it frees }. An id once in a batch.
 * @param {any} body
 * @returns {(Write | Delete)[]}
 */
export function parseBatch(body) {
  const writes = body?.writes ?? [];
  const deletes = body?.deletes ?? [];
  if (!Array.isArray(writes) || !Array.isArray(deletes)) throw new BadInput("Send writes and deletes as lists.");
  if (writes.length + deletes.length === 0) throw new BadInput("Nothing to save.");
  if (writes.length + deletes.length > MAX_BATCH) throw new BadInput(`Save up to ${MAX_BATCH} entries at once.`);
  /** @type {(Write | Delete)[]} */
  const ops = [
    ...writes.map((/** @type {any} */ w) => {
      const base = parseBase(w?.base_version);
      if (typeof w?.key !== "string" || !KEY.test(w.key)) throw new BadInput("Couldn't save: an entry's key wasn't sealed. Reload and try again.");
      if (typeof w?.body !== "string" || !BODY.test(w.body)) throw new BadInput("Couldn't save: an entry wasn't sealed. Reload and try again.");
      if (w.body.length > MAX_BODY) throw new BadInput("This entry has too much in it to save.");
      return /** @type {Write} */ ({
        op: "write", id: parseId(w.id), kind: parseKind(w.kind), base_version: base, version: base + 1, key: w.key, body: w.body,
      });
    }),
    ...deletes.map((/** @type {any} */ d) => {
      const base = parseBase(d?.base_version);
      if (base < 1) throw new BadInput("Say which version is being deleted.");
      const files = d?.files ?? [];
      if (!Array.isArray(files) || files.length > MAX_FILES_FREED) throw new BadInput("Send the files a delete frees as a list.");
      return /** @type {Delete} */ ({
        op: "delete", id: parseId(d.id), kind: parseKind(d.kind), base_version: base, files: [...new Set(files.map((f) => parseId(f, "file id")))],
      });
    }),
  ];
  if (new Set(ops.map((o) => o.id)).size !== ops.length) throw new BadInput("An entry is in the batch twice.");
  return ops;
}

/**
 * GET /api/sync's query: since (a sequence number, 0 for everything) and
 * limit (up to PAGE_ROWS).
 * @param {URL} url
 */
export function parseSyncQuery(url) {
  const since = Number(url.searchParams.get("since") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? PAGE_ROWS);
  if (!Number.isSafeInteger(since) || since < 0) throw new BadInput("since should be a sequence number, 0 or more.");
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_ROWS) throw new BadInput(`limit should be from 1 to ${PAGE_ROWS}.`);
  return { since, limit };
}

/**
 * Where a sync page ends: rows in seq order are taken until their bytes
 * pass PAGE_BYTES (always at least one).
 * @param {{ seq: number, bytes: number }[]} rows
 * @param {number} [maxBytes]
 * @returns {number} how many to take
 */
export function pageCut(rows, maxBytes = PAGE_BYTES) {
  let total = 0;
  for (const [i, row] of rows.entries()) {
    total += row.bytes;
    if (total > maxBytes) return Math.max(1, i);
  }
  return rows.length;
}

/** Writes that were based on a version that isn't the record's now. */
export class Stale extends Error {
  /** @param {string[]} ids */
  constructor(ids) {
    super("Another device changed these entries first.");
    this.name = "Stale";
    this.ids = ids;
  }
}

/** The account is over its 1 GB. */
export class OverQuota extends Error {}
