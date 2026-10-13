// Database queries for ties.

/** @typedef {import("./parse.js").TieInput} TieInput */

/**
 * My ties, newest first, each with its location, participants and plans.
 * Archived people, locations and plans still show here: archiving only hides
 * them from pickers. Deleted ones come back with null names, which the page
 * labels "(person deleted)", "(location deleted)" and "(plan deleted)".
 * @param {D1Database} db
 * @param {string} ownerId
 */
export async function listTies(db, ownerId) {
  /** @type {D1Result<Record<string, any>>[]} */
  const [ties, participants, plans] = await db.batch([
    db.prepare(
      `SELECT t.id, t.title, t.tie_date, t.duration_minutes, t.success_rating, t.notes, t.created_at,
              t.location_id, t.location_deleted, l.name AS location_name
         FROM ties t
         LEFT JOIN locations l ON l.id = t.location_id
        WHERE t.owner_id = ?
        ORDER BY t.tie_date DESC, t.created_at DESC`
    ).bind(ownerId),
    db.prepare(
      `SELECT tp.tie_id, tp.person_id, pe.name AS person_name, tp.role
         FROM tie_participants tp
         JOIN ties t ON t.id = tp.tie_id
         LEFT JOIN people pe ON pe.id = tp.person_id
        WHERE t.owner_id = ?
        ORDER BY pe.name COLLATE NOCASE`
    ).bind(ownerId),
    db.prepare(
      `SELECT tpl.tie_id, tpl.plan_id, p.title AS plan_title, tpl.plan_version
         FROM tie_plans tpl
         JOIN ties t ON t.id = tpl.tie_id
         LEFT JOIN plans p ON p.id = tpl.plan_id
        WHERE t.owner_id = ?
        ORDER BY p.title COLLATE NOCASE`
    ).bind(ownerId),
  ]);
  return assembleTies(ties.results, participants.results, plans.results);
}

/**
 * Nests each tie's participants and plans under it. Pure.
 * @param {Record<string, any>[]} ties
 * @param {Record<string, any>[]} participants rows with a tie_id
 * @param {Record<string, any>[]} plans rows with a tie_id
 */
export function assembleTies(ties, participants, plans) {
  const byId = new Map();
  for (const tie of ties) {
    byId.set(tie.id, { ...tie, participants: [], plans: [] });
  }
  for (const { tie_id, ...p } of participants) byId.get(tie_id)?.participants.push(p);
  for (const { tie_id, ...p } of plans) byId.get(tie_id)?.plans.push(p);
  return [...byId.values()];
}

/**
 * Adds a tie with its participants and plans in one batch (one transaction),
 * so a bad link saves nothing. The database's ownership triggers reject links
 * to other users' items.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {TieInput} tie
 * @returns {Promise<string>} the new id
 */
export async function insertTie(db, ownerId, tie) {
  const id = crypto.randomUUID();
  const statements = [
    db.prepare(
      `INSERT INTO ties (id, owner_id, title, tie_date, location_id, duration_minutes, success_rating, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, ownerId, tie.title, tie.tie_date, tie.location_id, tie.duration_minutes, tie.success_rating, tie.notes),
  ];
  for (const p of tie.participants) {
    statements.push(
      db.prepare("INSERT INTO tie_participants (id, tie_id, person_id, role) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), id, p.person_id, p.role)
    );
  }
  for (const planId of tie.plan_ids) {
    // Records which version of the plan this tie attempted.
    statements.push(
      db.prepare(
        `INSERT INTO tie_plans (id, tie_id, plan_id, plan_version)
         VALUES (?, ?, ?, (SELECT version FROM plans WHERE id = ? AND owner_id = ?))`
      ).bind(crypto.randomUUID(), id, planId, planId, ownerId)
    );
  }
  await db.batch(statements);
  return id;
}
