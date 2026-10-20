// Bug reports and ideas (migration 0015).

import { FEEDBACK_PER_DAY } from "./parse.js";

/**
 * Saves a report from me, unless I've sent FEEDBACK_PER_DAY in the last
 * day (checked in the same statement, so two at once can't both slip in).
 * @param {D1Database} db
 * @param {string} userId
 * @param {import("./parse.js").Feedback} feedback
 * @returns {Promise<string | null>} when it was saved; null: over the
 *   limit, nothing saved
 */
export async function addFeedback(db, userId, { kind, message, app_version }) {
  const row = await db.prepare(
    `INSERT INTO feedback (id, user_id, kind, message, app_version)
     SELECT ?1, ?2, ?3, ?4, ?5
      WHERE (SELECT COUNT(*) FROM feedback
              WHERE user_id = ?2 AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')) < ?6
     RETURNING created_at`
  ).bind(crypto.randomUUID(), userId, kind, message, app_version, FEEDBACK_PER_DAY).first();
  return row ? /** @type {string} */ (row.created_at) : null;
}
