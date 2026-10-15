// Encrypting notes written before encryption arrived: finding plain text
// that's left, overwriting it with what the browser sealed, and emptying
// every encrypted field (for a new key, which can't read the old ones).
// Every query is scoped to one owner (OWNER_SCOPE). updated_at isn't
// changed: encrypting notes isn't an edit.

import { ENCRYPTED_COLUMNS, OWNER_SCOPE, isPlain } from "./config.js";
import { jsonChunks } from "../data/import-plan.js";

/**
 * My rows with plain text left in an encrypted field: { table: [{ id,
 * field: value, ... }] }, each with all its encrypted fields (sealed ones
 * included, for the browser to leave alone).
 * @param {D1Database} db
 * @param {string} ownerId
 * @returns {Promise<Record<string, Record<string, unknown>[]>>}
 */
export async function plainRows(db, ownerId) {
  const tables = Object.keys(ENCRYPTED_COLUMNS);
  const results = await db.batch(tables.map((table) => {
    const columns = ENCRYPTED_COLUMNS[table];
    return db.prepare(
      `SELECT id, ${columns.join(", ")} FROM ${table}
        WHERE ${OWNER_SCOPE[table]} AND (${columns.map(isPlain).join(" OR ")})`
    ).bind(ownerId);
  }));
  return Object.fromEntries(tables.map((table, i) => [table, /** @type {Record<string, unknown>[]} */ (results[i].results)]));
}

/**
 * Overwrites plain text with sealed values: only fields still plain (so a
 * value sealed meanwhile, e.g. by an edit on another device, is kept), only
 * in my rows.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {Record<string, Record<string, unknown>[]>} rows by table, already checked
 */
export async function sealRows(db, ownerId, rows) {
  const statements = Object.entries(rows).flatMap(([table, list]) => {
    const columns = ENCRYPTED_COLUMNS[table];
    const set = columns.map((c) => `${c} = CASE WHEN ${isPlain(`${table}.${c}`)} THEN j.value ->> '$.${c}' ELSE ${table}.${c} END`);
    const sql = `UPDATE ${table} SET ${set.join(", ")}
                   FROM json_each(?2) j
                  WHERE ${table}.id = j.value ->> '$.id' AND ${table}.${OWNER_SCOPE[table]}`;
    return jsonChunks(list).map((chunk) => db.prepare(sql).bind(ownerId, chunk));
  });
  if (statements.length) await db.batch(statements);
}

/**
 * Statements that empty every encrypted field of mine, for a new key.
 * Profile notes are deleted instead: a profile note is just its type and
 * its description, which can't be empty.
 * @param {D1Database} db
 * @param {string} ownerId
 */
export function emptyEncryptedStatements(db, ownerId) {
  return Object.entries(ENCRYPTED_COLUMNS).map(([table, columns]) => db.prepare(
    table === "profile_notes"
      ? `DELETE FROM profile_notes WHERE ${OWNER_SCOPE.profile_notes}`
      : `UPDATE ${table} SET ${columns.map((c) => `${c} = NULL`).join(", ")} WHERE ${OWNER_SCOPE[table]}`
  ).bind(ownerId));
}
