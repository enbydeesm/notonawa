// Reading a whole account for export. Every query is scoped to the user,
// directly or through the row that owns it.

/** @typedef {import("./shape.js").AccountRows} AccountRows */

/**
 * Every row in my account, in one batch (so one consistent snapshot).
 * Includes archived items and unused tags; leaves out secrets (hashes,
 * passkeys' public keys) and sessions.
 * @param {D1Database} db
 * @param {string} userId
 * @returns {Promise<AccountRows>}
 */
export async function readAccount(db, userId) {
  const q = (/** @type {string} */ sql) => db.prepare(sql).bind(userId);
  const results = await db.batch([
    q("SELECT created_at, accepted_at, terms_version FROM users WHERE id = ?"),
    q("SELECT name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at"),
    q(`SELECT id, name, pronouns, notes, is_self, default_role, archived_at, created_at, updated_at
         FROM people WHERE owner_id = ? ORDER BY created_at, id`),
    q(`SELECT n.person_id, n.type, n.description, n.noted_on, n.is_current, n.created_at, n.updated_at
         FROM profile_notes n JOIN people p ON p.id = n.person_id
        WHERE p.owner_id = ? ORDER BY n.created_at, n.id`),
    q(`SELECT id, name, notes, hard_points, maps_url, latitude, longitude, archived_at, created_at, updated_at
         FROM locations WHERE owner_id = ? ORDER BY created_at, id`),
    q(`SELECT id, title, stage, description, notes, est_difficulty, variation_of, version, archived_at, created_at, updated_at
         FROM plans WHERE owner_id = ? ORDER BY created_at, id`),
    q(`SELECT pt.plan_id, t.name FROM plan_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE t.owner_id = ? ORDER BY t.name COLLATE NOCASE`),
    q("SELECT name FROM tags WHERE owner_id = ? ORDER BY name COLLATE NOCASE"),
    q(`SELECT id, title, tie_date, tie_type, duration_minutes, success_rating, notes, location_id, location_deleted, created_at, updated_at
         FROM ties WHERE owner_id = ? ORDER BY tie_date, created_at, id`),
    q(`SELECT tp.tie_id, tp.person_id, tp.role, tp.difficulty_rating, tp.experience_rating, tp.notes
         FROM tie_participants tp JOIN ties t ON t.id = tp.tie_id
        WHERE t.owner_id = ? ORDER BY tp.rowid`),
    q(`SELECT tp.tie_id, tp.plan_id, tp.plan_version
         FROM tie_plans tp JOIN ties t ON t.id = tp.tie_id
        WHERE t.owner_id = ? ORDER BY tp.rowid`),
    q(`SELECT tt.tie_id, tg.name FROM tie_tags tt JOIN tags tg ON tg.id = tt.tag_id
        WHERE tg.owner_id = ? ORDER BY tg.name COLLATE NOCASE`),
  ]);
  const [user, passkeys, people, profileNotes, locations, plans, planTags, tags, ties, participants, tiePlans, tieTags] =
    /** @type {Record<string, any>[][]} */ (results.map((r) => r.results));
  return {
    user: user[0], passkeys, people, profileNotes, locations, plans, planTags, tags,
    ties, participants, tiePlans, tieTags,
  };
}
