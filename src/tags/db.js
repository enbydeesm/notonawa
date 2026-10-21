// Database queries for tags. Ties, plans and workshops share one list of tags.

import { matchTags } from "./parse.js";

/**
 * All my tags, most recently used first: by the newest tie each is on (tie
 * date, then when it was logged). Tags on no tie (only on plans, or on
 * nothing) come last, A–Z. plan_count and workshop_count: how many plans
 * and workshops have it.
 * @param {D1Database} db
 * @param {string} ownerId
 * @returns {Promise<{ id: string, name: string, tie_count: number, plan_count: number, workshop_count: number }[]>}
 */
export async function listTags(db, ownerId) {
  // Sorts on each tag's newest "tie date|logged at".
  const { results } = await db.prepare(
    `SELECT t.id, t.name, COUNT(ti.id) AS tie_count,
            (SELECT COUNT(*) FROM plan_tags pt WHERE pt.tag_id = t.id) AS plan_count,
            (SELECT COUNT(*) FROM workshop_tags wt WHERE wt.tag_id = t.id) AS workshop_count
       FROM tags t
       LEFT JOIN tie_tags tt ON tt.tag_id = t.id
       LEFT JOIN ties ti ON ti.id = tt.tie_id
      WHERE t.owner_id = ?
      GROUP BY t.id
      ORDER BY MAX(ti.tie_date || '|' || ti.created_at) IS NULL,
               MAX(ti.tie_date || '|' || ti.created_at) DESC,
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
 * Deletes one of my tags. Its links to ties, plans and workshops go with it (cascade).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<boolean>} false if there was no such tag of mine
 */
export async function deleteTag(db, ownerId, id) {
  const result = await db.prepare("DELETE FROM tags WHERE id = ? AND owner_id = ?").bind(id, ownerId).run();
  return result.meta.changes > 0;
}

// The link table for each kind of item with tags, and the item's own table
// (fixed names, safe in SQL).
const LINKS = {
  tie: { table: "tie_tags", column: "tie_id", items: "ties" },
  plan: { table: "plan_tags", column: "plan_id", items: "plans" },
  workshop: { table: "workshop_tags", column: "workshop_id", items: "workshops" },
};

/**
 * Takes all its tags off one of my ties, plans or workshops, before linking the ones
 * it's saved with (tagStatements), in the same batch.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {keyof typeof LINKS} kind
 * @param {string} itemId
 */
export function clearTagsStatement(db, ownerId, kind, itemId) {
  const { table, column, items } = LINKS[kind];
  return db.prepare(`DELETE FROM ${table} WHERE ${column} = ? AND ${column} IN (SELECT id FROM ${items} WHERE owner_id = ?)`)
    .bind(itemId, ownerId);
}

/**
 * Statements linking a tie, plan or workshop to its tags, for the batch that saves
 * it. Tags not matching one of mine (ignoring capitals) are created here.
 * If the same tag was created a moment ago elsewhere, DO NOTHING keeps that
 * one, and the link finds it by name either way. The database's ownership
 * triggers refuse a link to someone else's tie, plan or workshop.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {keyof typeof LINKS} kind
 * @param {string} itemId
 * @param {string[]} names
 */
export async function tagStatements(db, ownerId, kind, itemId, names) {
  const { table, column } = LINKS[kind];
  const tags = names.length ? matchTags(await tagNames(db, ownerId), names) : [];
  return tags.flatMap((tag) => [
    ...(tag.isNew ? [
      db.prepare("INSERT INTO tags (id, owner_id, name) VALUES (?, ?, ?) ON CONFLICT (owner_id, name) DO NOTHING")
        .bind(crypto.randomUUID(), ownerId, tag.name),
    ] : []),
    db.prepare(`INSERT INTO ${table} (${column}, tag_id) SELECT ?, id FROM tags WHERE owner_id = ? AND name = ?`)
      .bind(itemId, ownerId, tag.name),
  ]);
}
