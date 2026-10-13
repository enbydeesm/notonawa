// Database queries for plans, people and locations.
// `name` is always a ResourceName from config.js, never request data.

import { NOW } from "../sql.js";
import { RESOURCES } from "./config.js";

/** @typedef {import("./config.js").ResourceName} ResourceName */

/**
 * Active items (archived_at IS NULL) or archived ones.
 * @param {D1Database} db
 * @param {ResourceName} name
 * @param {string} ownerId
 * @param {boolean} archived
 */
export async function listRows(db, name, ownerId, archived) {
  const { columns, orderBy } = RESOURCES[name];
  const { results } = await db.prepare(
    `SELECT ${columns} FROM ${name}
      WHERE owner_id = ? AND archived_at IS ${archived ? "NOT NULL" : "NULL"}
      ORDER BY ${orderBy}`
  )
    .bind(ownerId)
    .all();
  return results;
}

/**
 * @param {D1Database} db
 * @param {ResourceName} name
 * @param {string} ownerId
 * @param {{ columns: string[], values: unknown[] }} fields
 * @param {boolean} archiveNow
 * @returns {Promise<string>} the new id
 */
export async function insertRow(db, name, ownerId, { columns, values }, archiveNow) {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO ${name} (id, owner_id, ${columns.join(", ")}, archived_at)
     VALUES (?, ?, ${columns.map(() => "?").join(", ")}, ${archiveNow ? NOW : "NULL"})`
  )
    .bind(id, ownerId, ...values)
    .run();
  return id;
}

/**
 * Saves all fields. Returns null if there's no such item for this owner.
 * @param {D1Database} db
 * @param {ResourceName} name
 * @param {string} ownerId
 * @param {string} id
 * @param {{ columns: string[], values: unknown[] }} fields
 */
export function updateRow(db, name, ownerId, id, { columns, values }) {
  return db.prepare(
    `UPDATE ${name}
        SET ${columns.map((c) => `${c} = ?`).join(", ")}, updated_at = ${NOW}
      WHERE id = ? AND owner_id = ?
     RETURNING id`
  )
    .bind(...values, id, ownerId)
    .first();
}

/**
 * Archiving again keeps the original date. A plan's stage is left alone, so
 * restoring brings it back exactly as it was.
 * @param {D1Database} db
 * @param {ResourceName} name
 * @param {string} ownerId
 * @param {string} id
 */
export function archiveRow(db, name, ownerId, id) {
  return db.prepare(
    `UPDATE ${name}
        SET archived_at = COALESCE(archived_at, ${NOW}), updated_at = ${NOW}
      WHERE id = ? AND owner_id = ?
     RETURNING id, archived_at`
  )
    .bind(id, ownerId)
    .first();
}

/**
 * @param {D1Database} db
 * @param {ResourceName} name
 * @param {string} ownerId
 * @param {string} id
 */
export function restoreRow(db, name, ownerId, id) {
  return db.prepare(
    `UPDATE ${name}
        SET archived_at = NULL, updated_at = ${NOW}
      WHERE id = ? AND owner_id = ? AND archived_at IS NOT NULL
     RETURNING id`
  )
    .bind(id, ownerId)
    .first();
}

/**
 * People and locations: delete for good. Returns whether it existed.
 * A deleted person's tie_participants rows stay, with person_id set to NULL
 * (shown as "(person deleted)"). A deleted location's ties stay, with
 * location_id NULL and location_deleted = 1 ("(location deleted)").
 * @param {D1Database} db
 * @param {"people" | "locations"} name
 * @param {string} ownerId
 * @param {string} id
 */
export async function deleteRow(db, name, ownerId, id) {
  const row = await db.prepare(`DELETE FROM ${name} WHERE id = ? AND owner_id = ? RETURNING id`)
    .bind(id, ownerId)
    .first();
  return row !== null;
}

/**
 * Plans: delete for good. Returns whether it existed.
 *   remove: also delete the plan's tie_plans rows, so ties show no trace of it
 *   keep:   tie_plans rows stay with plan_id NULL ("(plan deleted)")
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @param {"remove" | "keep"} linkedTies
 */
export async function deletePlan(db, ownerId, id, linkedTies) {
  const deleteStatement = db.prepare("DELETE FROM plans WHERE id = ? AND owner_id = ? RETURNING id")
    .bind(id, ownerId);

  if (linkedTies === "keep") {
    return (await deleteStatement.first()) !== null;
  }

  // One batch = one transaction, so the links and the plan go together.
  const [, planResult] = await db.batch([
    db.prepare(
      `DELETE FROM tie_plans
        WHERE plan_id = (SELECT id FROM plans WHERE id = ? AND owner_id = ?)`
    ).bind(id, ownerId),
    deleteStatement,
  ]);
  return planResult.results.length > 0;
}
