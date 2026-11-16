// Sealed records (format 2) in D1: sync pages, and batches of writes and
// deletes, each batch one transaction (D1's batch()).
//
// A batch's checks are statements in it, so nothing is read and then
// written apart: each write or delete starts with an INSERT into
// version_checks that puts a NULL in (failing the batch) unless the record
// is at the version the device based it on (or, for a new one, its id is
// unused). The batch ends, if it writes anything, with the same into
// quota_checks if the account is then over its 1 GB.

import { accountBytes } from "../sql.js";
import { MAX_ACCOUNT_BYTES } from "../media/parse.js";
import { Stale, OverQuota } from "./parse.js";

/**
 * @typedef {import("./parse.js").Write} Write
 * @typedef {import("./parse.js").Delete} Delete
 * @typedef {{ id: string, kind: string, seq: number, deleted: boolean, version: number | null, key: string | null, body: string | null }} Change
 */

/**
 * One sync page: records and deletion markers with seq above since, oldest
 * first, as many as fit (limit rows, about PAGE_BYTES of bodies).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {{ since: number, limit: number }} query
 * @param {(rows: { seq: number, bytes: number }[]) => number} cut how many rows a page takes
 * @returns {Promise<{ changes: Change[], next: number, done: boolean }>}
 */
export async function syncPage(db, ownerId, { since, limit }, cut) {
  // Sizes first, to see where the page ends; then only those bodies.
  const { results: sizes } = await db.prepare(
    `SELECT seq, bytes FROM records WHERE owner_id = ?1 AND seq > ?2
     UNION ALL SELECT seq, 0 AS bytes FROM record_deletions WHERE owner_id = ?1 AND seq > ?2
     ORDER BY seq LIMIT ?3`
  ).bind(ownerId, since, limit + 1).all();
  const rows = /** @type {{ seq: number, bytes: number }[]} */ (sizes);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const take = cut(page);
  if (take === 0) return { changes: [], next: since, done: true };
  const last = page[take - 1].seq;
  const { results } = await db.prepare(
    `SELECT id, kind, seq, version, key, body, 0 AS deleted FROM records WHERE owner_id = ?1 AND seq > ?2 AND seq <= ?3
     UNION ALL SELECT id, kind, seq, NULL, NULL, NULL, 1 AS deleted FROM record_deletions WHERE owner_id = ?1 AND seq > ?2 AND seq <= ?3
     ORDER BY seq`
  ).bind(ownerId, since, last).all();
  return {
    changes: results.map((r) => /** @type {Change} */ ({ ...r, deleted: r.deleted === 1 })),
    next: last,
    done: !more && take === page.length,
  };
}

/**
 * Writes and deletes records in one batch: all of them or, if any was
 * stale or the account would be over its quota, none.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {(Write | Delete)[]} ops
 * @returns {Promise<{ saved: { id: string, version: number | null, seq: number }[], freed: string[] }>}
 *   freed: the file ids deletes freed that were mine (their objects are the caller's to delete)
 * @throws {Stale | OverQuota}
 */
export async function writeRecords(db, ownerId, ops) {
  const n = ops.length;
  const freedIds = ops.flatMap((o) => (o.op === "delete" ? o.files : []));
  const statements = [
    // The files the deletes free, read before they go.
    db.prepare("SELECT id FROM files WHERE owner_id = ?1 AND id IN (SELECT value FROM json_each(?2))").bind(ownerId, JSON.stringify(freedIds)),
    db.prepare("UPDATE users SET sync_seq = sync_seq + ?2 WHERE id = ?1").bind(ownerId, n),
  ];
  // Op i's seq: the account's new sync_seq, less those after it.
  const seq = "(SELECT sync_seq FROM users WHERE id = ?2) - ?4";
  for (const [i, op] of ops.entries()) {
    const after = n - i - 1;
    if (op.op === "write" && op.base_version === 0) {
      statements.push(
        db.prepare(`INSERT INTO version_checks (ok) SELECT NULL
                     WHERE EXISTS (SELECT 1 FROM records WHERE id = ?1) OR EXISTS (SELECT 1 FROM record_deletions WHERE id = ?1)`).bind(op.id),
        db.prepare(`INSERT INTO records (id, owner_id, kind, version, seq, key, body, bytes) VALUES (?1, ?2, ?3, 1, ${seq}, ?5, ?6, ?7)`)
          .bind(op.id, ownerId, op.kind, after, op.key, op.body, op.key.length + op.body.length),
      );
      continue;
    }
    statements.push(db.prepare(`INSERT INTO version_checks (ok) SELECT NULL
       WHERE NOT EXISTS (SELECT 1 FROM records WHERE id = ?1 AND owner_id = ?2 AND kind = ?3 AND version = ?4)`)
      .bind(op.id, ownerId, op.kind, op.base_version));
    if (op.op === "write") {
      statements.push(db.prepare(`UPDATE records SET version = ?3, seq = ${seq}, key = ?5, body = ?6, bytes = ?7 WHERE id = ?1 AND owner_id = ?2`)
        .bind(op.id, ownerId, op.version, after, op.key, op.body, op.key.length + op.body.length));
    } else {
      statements.push(
        db.prepare("DELETE FROM records WHERE id = ?1 AND owner_id = ?2").bind(op.id, ownerId),
        db.prepare(`INSERT INTO record_deletions (id, owner_id, kind, seq) VALUES (?1, ?2, ?3, ${seq})`).bind(op.id, ownerId, op.kind, after),
      );
    }
  }
  if (freedIds.length) {
    statements.push(db.prepare("DELETE FROM files WHERE owner_id = ?1 AND id IN (SELECT value FROM json_each(?2))")
      .bind(ownerId, JSON.stringify(freedIds)));
  }
  if (ops.some((o) => o.op === "write")) {
    statements.push(db.prepare(`INSERT INTO quota_checks (ok) SELECT NULL WHERE ${accountBytes("?1")} > ?2`).bind(ownerId, MAX_ACCOUNT_BYTES));
  }
  statements.push(db.prepare("SELECT sync_seq FROM users WHERE id = ?1").bind(ownerId));

  /** @type {D1Result[]} */
  let results;
  try {
    results = await db.batch(statements);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/quota_checks\.ok/.test(message)) throw new OverQuota();
    if (/version_checks\.ok|stale:/.test(message)) throw new Stale(await staleIds(db, ownerId, ops));
    throw err;
  }
  const last = /** @type {number} */ (/** @type {any} */ (results[results.length - 1].results[0]).sync_seq);
  return {
    saved: ops.map((op, i) => ({ id: op.id, version: op.op === "write" ? op.version : null, seq: last - (n - i - 1) })),
    freed: /** @type {{ id: string }[]} */ (results[0].results).map((r) => r.id),
  };
}

/**
 * After a refused batch, which of its ops were stale: their record isn't
 * at the version they were based on now (or, for a new one, its id is
 * taken).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {(Write | Delete)[]} ops
 */
async function staleIds(db, ownerId, ops) {
  const ids = JSON.stringify(ops.map((o) => o.id));
  const [{ results: live }, { results: gone }] = await db.batch([
    db.prepare("SELECT id, owner_id, kind, version FROM records WHERE id IN (SELECT value FROM json_each(?1))").bind(ids),
    db.prepare("SELECT id FROM record_deletions WHERE id IN (SELECT value FROM json_each(?1))").bind(ids),
  ]);
  const now = new Map(/** @type {any[]} */ (live).map((r) => [r.id, r]));
  const deleted = new Set(/** @type {any[]} */ (gone).map((r) => r.id));
  return ops.filter((op) => {
    const row = now.get(op.id);
    if (op.base_version === 0) return row !== undefined || deleted.has(op.id);
    return !row || row.owner_id !== ownerId || row.kind !== op.kind || row.version !== op.base_version;
  }).map((op) => op.id);
}
