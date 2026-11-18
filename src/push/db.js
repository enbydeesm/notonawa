// Push subscriptions (migration 0035): one per device, for the account
// signed in there. A device knows its own by its push address (endpoint),
// so a page asks about "this device's" with it in the body.

import { NOW } from "../sql.js";

/**
 * @typedef {{ id: string, endpoint: string, p256dh: string, auth: string }} Subscription
 */

/**
 * Saves this device's subscription for me, with the kinds it wants. One
 * another account had on this device is replaced (a subscription's owner
 * never changes): the device's notifications follow whoever signs in.
 * @param {D1Database} db
 * @param {string} userId
 * @param {{ endpoint: string, p256dh: string, auth: string, connections: boolean, announcements: boolean }} sub
 */
export async function saveSubscription(db, userId, sub) {
  const mine = await db.prepare("SELECT id FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
    .bind(sub.endpoint, userId).first();
  if (mine) {
    await db.prepare(
      `UPDATE push_subscriptions SET p256dh = ?, auth = ?, connections = ?, announcements = ?, updated_at = ${NOW}
        WHERE id = ? AND user_id = ?`
    ).bind(sub.p256dh, sub.auth, Number(sub.connections), Number(sub.announcements), mine.id, userId).run();
    return;
  }
  await db.batch([
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint),
    db.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, connections, announcements)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), userId, sub.endpoint, sub.p256dh, sub.auth, Number(sub.connections), Number(sub.announcements)),
  ]);
}

/**
 * The kinds this device gets, if it's subscribed for me.
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} endpoint
 * @returns {Promise<{ connections: number, announcements: number } | null>}
 */
export function subscriptionKinds(db, userId, endpoint) {
  return db.prepare("SELECT connections, announcements FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
    .bind(endpoint, userId).first();
}

/**
 * Stops notifications on this device for me.
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} endpoint
 */
export async function deleteSubscription(db, userId, endpoint) {
  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(endpoint, userId).run();
}

/**
 * An account's devices that want a kind of notification.
 * @param {D1Database} db
 * @param {string} userId
 * @param {"connections" | "announcements"} kind a column, from KINDS
 * @returns {Promise<Subscription[]>}
 */
export async function subscriptionsFor(db, userId, kind) {
  const { results } = await db.prepare(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? AND ${kind === "connections" ? "connections" : "announcements"} = 1`
  ).bind(userId).all();
  return /** @type {Subscription[]} */ (results);
}

/**
 * The owner of a mailbox, to notify when a message lands in it.
 * @param {D1Database} db
 * @param {string} mailboxId
 * @returns {Promise<string | null>}
 */
export async function mailboxOwner(db, mailboxId) {
  const row = await db.prepare("SELECT owner_id FROM mailboxes WHERE id = ?").bind(mailboxId).first();
  return row ? /** @type {string} */ (row.owner_id) : null;
}

/**
 * Deletes subscriptions whose push address the push service says is gone.
 * @param {D1Database} db
 * @param {string[]} ids
 */
export async function deleteGone(db, ids) {
  if (ids.length === 0) return;
  await db.batch(ids.map((id) => db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(id)));
}

/**
 * Notices to send as notifications: --push, showing now, not yet sent to
 * everyone.
 * @param {D1Database} db
 * @returns {Promise<{ id: string, user_id: string | null, message: string, push_cursor: string | null }[]>}
 */
export async function noticesToPush(db) {
  const { results } = await db.prepare(
    `SELECT id, user_id, message, push_cursor FROM notices
      WHERE push = 1 AND pushed_at IS NULL AND starts_at <= ${NOW} AND (ends_at IS NULL OR ends_at > ${NOW})
      ORDER BY starts_at`
  ).all();
  return /** @type {any[]} */ (results);
}

/**
 * The next devices a notice goes to: wanting announcements, the notice's
 * account's only if it's for one, after the last one it was sent to.
 * @param {D1Database} db
 * @param {{ user_id: string | null, push_cursor: string | null }} notice
 * @param {number} limit
 * @returns {Promise<Subscription[]>}
 */
export async function noticeRecipients(db, notice, limit) {
  const { results } = await db.prepare(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
      WHERE announcements = 1 AND (?1 IS NULL OR user_id = ?1) AND id > ?2 ORDER BY id LIMIT ?3`
  ).bind(notice.user_id, notice.push_cursor ?? "", limit).all();
  return /** @type {Subscription[]} */ (results);
}

/**
 * Where a notice's sending got to; done once every device has had it.
 * @param {D1Database} db
 * @param {string} id
 * @param {string | null} cursor
 * @param {boolean} done
 */
export async function noticePushedTo(db, id, cursor, done) {
  await db.prepare(`UPDATE notices SET push_cursor = ?, pushed_at = ${done ? NOW : "NULL"} WHERE id = ?`).bind(cursor, id).run();
}
