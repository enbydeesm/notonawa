// The daily job's part for mailboxes: invites' intro mailboxes that have
// expired (with any message in them), and messages left unfetched for 90
// days.

import { NOW } from "../sql.js";

/**
 * @param {D1Database} db
 * @returns {Promise<{ mailboxes: number, messages: number }>} how many were deleted
 */
export async function cleanUpMailboxes(db) {
  const [boxes, messages] = await db.batch([
    db.prepare(`DELETE FROM mailboxes WHERE expires_at IS NOT NULL AND expires_at <= ${NOW}`),
    db.prepare(`DELETE FROM mailbox_messages WHERE expires_at <= ${NOW}`),
  ]);
  return { mailboxes: boxes.meta.changes, messages: messages.meta.changes };
}
