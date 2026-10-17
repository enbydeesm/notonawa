// Notices: messages from us in the app (migration 0012).

import { NOW } from "../sql.js";

/**
 * The notices showing for me now that I haven't dismissed, newest first.
 * @param {D1Database} db
 * @param {string} userId
 */
export async function activeNotices(db, userId) {
  const { results } = await db.prepare(
    `SELECT n.id, n.message, n.level, n.link, n.starts_at
       FROM notices n
      WHERE (n.user_id IS NULL OR n.user_id = ?1)
        AND n.starts_at <= ${NOW} AND (n.ends_at IS NULL OR n.ends_at > ${NOW})
        AND NOT EXISTS (SELECT 1 FROM notice_dismissals d WHERE d.notice_id = n.id AND d.user_id = ?1)
      ORDER BY n.starts_at DESC, n.id`
  ).bind(userId).all();
  return results;
}

/**
 * Dismisses one of my notices (for everyone, or for me). False if there's
 * no such notice for me.
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} noticeId
 */
export async function dismissNotice(db, userId, noticeId) {
  const result = await db.prepare(
    `INSERT OR IGNORE INTO notice_dismissals (notice_id, user_id)
     SELECT id, ?1 FROM notices WHERE id = ?2 AND (user_id IS NULL OR user_id = ?1)`
  ).bind(userId, noticeId).run();
  if (result.meta.changes > 0) return true;
  // Already dismissed is fine too.
  const known = await db.prepare("SELECT 1 FROM notices WHERE id = ?2 AND (user_id IS NULL OR user_id = ?1)")
    .bind(userId, noticeId).first();
  return known !== null;
}
