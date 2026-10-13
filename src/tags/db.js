// Database queries for tags.

/**
 * All my tags, most recently used first: by the newest tie each is on (tie
 * date, then when it was logged). Tags on no tie come last, A–Z. Ties with no
 * date count as older than any dated tie, as in the ties list.
 * @param {D1Database} db
 * @param {string} ownerId
 * @returns {Promise<{ id: string, name: string, tie_count: number }[]>}
 */
export async function listTags(db, ownerId) {
  // Sorts on each tag's newest "tie date|logged at"; undated ties get a date
  // before any real one.
  const { results } = await db.prepare(
    `SELECT t.id, t.name, COUNT(ti.id) AS tie_count
       FROM tags t
       LEFT JOIN tie_tags tt ON tt.tag_id = t.id
       LEFT JOIN ties ti ON ti.id = tt.tie_id
      WHERE t.owner_id = ?
      GROUP BY t.id
      ORDER BY MAX(COALESCE(ti.tie_date, '0000-00-00') || '|' || ti.created_at) IS NULL,
               MAX(COALESCE(ti.tie_date, '0000-00-00') || '|' || ti.created_at) DESC,
               t.name COLLATE NOCASE`
  ).bind(ownerId).all();
  return /** @type {any} */ (results);
}

/**
 * Just my tags' ids and names, for matching a tie's tags to them.
 * @param {D1Database} db
 * @param {string} ownerId
 * @returns {Promise<{ id: string, name: string }[]>}
 */
export async function tagNames(db, ownerId) {
  const { results } = await db.prepare("SELECT id, name FROM tags WHERE owner_id = ?").bind(ownerId).all();
  return /** @type {any} */ (results);
}

/**
 * Deletes one of my tags. Its links to ties and plans go with it (cascade).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<boolean>} false if there was no such tag of mine
 */
export async function deleteTag(db, ownerId, id) {
  const result = await db.prepare("DELETE FROM tags WHERE id = ? AND owner_id = ?").bind(id, ownerId).run();
  return result.meta.changes > 0;
}
