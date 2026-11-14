// Mailboxes and their messages in D1. A mailbox keeps only its token's
// hash; a message, only its sealed body and when it came.

import { NOW } from "../sql.js";
import { MAX_MAILBOXES, MAX_WAITING, MESSAGE_DAYS } from "./parse.js";

/**
 * Adds a mailbox of mine, if I have fewer than MAX_MAILBOXES.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {{ id: string, tokenHash: string, kind: "intro" | "contact", expiresAt: string | null }} mailbox
 * @returns {Promise<boolean>} whether it was added
 */
export async function addMailbox(db, ownerId, { id, tokenHash, kind, expiresAt }) {
  const result = await db.prepare(
    `INSERT INTO mailboxes (id, owner_id, token_hash, kind, expires_at)
     SELECT ?1, ?2, ?3, ?4, ?5 WHERE (SELECT COUNT(*) FROM mailboxes WHERE owner_id = ?2) < ?6`
  ).bind(id, ownerId, tokenHash, kind, expiresAt, MAX_MAILBOXES).run();
  return result.meta.changes === 1;
}

/**
 * Deletes a mailbox of mine, and its messages.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<boolean>} whether it was mine
 */
export async function deleteMailbox(db, ownerId, id) {
  const result = await db.prepare("DELETE FROM mailboxes WHERE id = ? AND owner_id = ?").bind(id, ownerId).run();
  // D1 counts the messages deleted with it too, so any change is a yes.
  return result.meta.changes > 0;
}

/**
 * Leaves a message in a mailbox, if the token is its and it's open (not an
 * expired intro) and not full. A profile message replaces one waiting.
 * @param {D1Database} db
 * @param {string} mailboxId
 * @param {string} tokenHash
 * @param {{ slot: "profile" | null, sealed: string }} message
 * @returns {Promise<"sent" | "full" | "unknown">} unknown: no such open mailbox, or the wrong token
 */
export async function deliver(db, mailboxId, tokenHash, { slot, sealed }) {
  const open = `m.id = ?2 AND m.token_hash = ?3 AND (m.expires_at IS NULL OR m.expires_at > ${NOW})`;
  const result = await db.prepare(
    `INSERT INTO mailbox_messages (id, mailbox_id, slot, body, bytes, expires_at)
     SELECT ?1, m.id, ?4, ?5, ?6, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+${MESSAGE_DAYS} days') FROM mailboxes m
      WHERE ${open} AND ((SELECT COUNT(*) FROM mailbox_messages WHERE mailbox_id = m.id) < ?7
        OR (?4 IS NOT NULL AND EXISTS (SELECT 1 FROM mailbox_messages WHERE mailbox_id = m.id AND slot = ?4)))
     ON CONFLICT (mailbox_id, slot) WHERE slot IS NOT NULL
     DO UPDATE SET id = excluded.id, body = excluded.body, bytes = excluded.bytes, created_at = ${NOW}, expires_at = excluded.expires_at`
  ).bind(crypto.randomUUID(), mailboxId, tokenHash, slot, sealed, sealed.length, MAX_WAITING).run();
  if (result.meta.changes > 0) return "sent";
  const exists = await db.prepare(`SELECT 1 AS ok FROM mailboxes m WHERE ${open.replace("?2", "?1").replace("?3", "?2")}`)
    .bind(mailboxId, tokenHash).first();
  return exists ? "full" : "unknown";
}

/**
 * Every message waiting in my mailboxes, oldest first.
 * @param {D1Database} db
 * @param {string} ownerId
 */
export async function listMessages(db, ownerId) {
  const { results } = await db.prepare(
    `SELECT msg.id, msg.mailbox_id, msg.slot, msg.body, msg.created_at FROM mailbox_messages msg
       JOIN mailboxes m ON m.id = msg.mailbox_id WHERE m.owner_id = ? ORDER BY msg.created_at, msg.id`
  ).bind(ownerId).all();
  return results;
}

/**
 * Deletes messages of mine, once my device has applied them.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string[]} ids
 * @returns {Promise<number>} how many were mine
 */
export async function ackMessages(db, ownerId, ids) {
  const result = await db.prepare(
    `DELETE FROM mailbox_messages WHERE id IN (SELECT value FROM json_each(?1))
       AND mailbox_id IN (SELECT id FROM mailboxes WHERE owner_id = ?2)`
  ).bind(JSON.stringify(ids), ownerId).run();
  return result.meta.changes;
}
