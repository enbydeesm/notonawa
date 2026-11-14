// Converting an account from format 1 to format 2 (migration 0032): marking
// it as converting, and the finish, which makes it format 2 and deletes its
// format 1 journal in one batch.

import { NOW } from "../sql.js";

/**
 * The format 1 journal's tables, in the order the finish deletes them: the
 * items that link to others first, so no trigger or ON DELETE SET NULL has
 * work left to do (deleting a location marks its ties and workshops), and
 * their child rows (tie_participants, plan_tags, profile_notes, …) going
 * with them by cascade. Connections stay: each has another account's side,
 * and phase 6 decides what becomes of them; shares stay too (sealed with
 * their links' keys, not the journal's).
 */
export const V1_TABLES = /** @type {const} */ ([
  "media", "drawings", "poses", "ties", "workshops", "plans", "people", "locations", "tags", "pose_presets",
]);

/** The account isn't converting (or is format 2 already). */
export class NotConverting extends Error {}

/**
 * Marks a format 1 account as converting (once: starting again keeps the
 * first time, which another device reads as when it began).
 * @param {D1Database} db
 * @param {string} userId
 * @returns {Promise<string | null>} converting_since, or null if the account is format 2
 */
export async function startConversion(db, userId) {
  const row = await db.prepare(
    `UPDATE users SET converting_since = COALESCE(converting_since, ${NOW})
     WHERE id = ? AND format = 1 RETURNING converting_since`,
  ).bind(userId).first();
  return /** @type {string | null} */ (row?.converting_since ?? null);
}

/**
 * Finishes the conversion, all or nothing: the account becomes format 2 and
 * its format 1 journal is deleted. Refused unless it's converting and has
 * at least one record (a conversion always writes "Me"), so a page gone
 * wrong can't delete a journal that has no copy.
 * @param {D1Database} db
 * @param {string} userId
 * @returns {Promise<string[]>} the format 1 photos' and videos' ids, whose R2 objects are the caller's to delete
 * @throws {NotConverting}
 */
export async function finishConversion(db, userId) {
  const statements = [
    db.prepare(`INSERT INTO version_checks (ok) SELECT NULL
                WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = ?1 AND format = 1 AND converting_since IS NOT NULL)
                   OR NOT EXISTS (SELECT 1 FROM records WHERE owner_id = ?1)`).bind(userId),
    // Read in the same batch as the delete, so none can be added between.
    db.prepare("SELECT id FROM media WHERE owner_id = ?").bind(userId),
    db.prepare(`UPDATE users SET format = 2, converted_at = ${NOW}, converting_since = NULL WHERE id = ?`).bind(userId),
    // Table names from the fixed list above, never from a request.
    ...V1_TABLES.map((table) => db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).bind(userId)),
  ];
  try {
    const results = await db.batch(statements);
    return /** @type {{ id: string }[]} */ (results[1].results).map((r) => r.id);
  } catch (err) {
    if (/version_checks\.ok/.test(err instanceof Error ? err.message : "")) throw new NotConverting();
    throw err;
  }
}
