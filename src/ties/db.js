// Database queries for ties.

import { tieFilterSql } from "./search.js";
import { tagStatements } from "../tags/db.js";
import { NOW } from "../sql.js";
import { mediaOfStatement } from "../media/db.js";

/** @typedef {import("./parse.js").TieInput} TieInput */
/** @typedef {import("./parse.js").TieFilters} TieFilters */

// Same-day ties go by when they were logged, then id, so the order (and
// which page a tie lands on) never shifts between requests. "oldest" is the
// exact reverse.
const ORDER = "ORDER BY t.tie_date DESC, t.created_at DESC, t.id DESC";
const ORDER_OLDEST = "ORDER BY t.tie_date, t.created_at, t.id";

/**
 * How each kind of item links to ties, as SQL joining ties t to the item x.
 * Fixed text, never from the request.
 * @type {Record<import("./parse.js").RecentType, string>}
 */
const RECENT_JOINS = {
  locations: "JOIN locations x ON x.id = t.location_id",
  people: "JOIN tie_participants tp ON tp.tie_id = t.id JOIN people x ON x.id = tp.person_id",
  plans: "JOIN tie_plans tpl ON tpl.tie_id = t.id JOIN plans x ON x.id = tpl.plan_id",
};

/**
 * Ids of my active locations, people or plans, most recently on a tie first
 * (by tie date). For the tie form's
 * pickers, so archived ones are left out.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {import("./parse.js").RecentType} type
 * @param {number} limit
 * @returns {Promise<string[]>}
 */
export async function recentIds(db, ownerId, type, limit) {
  const { results } = await db.prepare(
    `SELECT x.id
       FROM ties t
       ${RECENT_JOINS[type]}
      WHERE t.owner_id = ? AND x.owner_id = t.owner_id AND x.archived_at IS NULL
      GROUP BY x.id
      ORDER BY MAX(t.tie_date) DESC, MAX(t.created_at) DESC, x.id
      LIMIT ?`
  ).bind(ownerId, limit).all();
  return results.map((r) => /** @type {string} */ (r.id));
}

/**
 * One page of my ties that match the filters, in tie date order (newest
 * first unless sort is "oldest"), each with its location, participants,
 * plans and tags, plus how many match and how many I have in all.
 * Archived people, locations and plans still show here: archiving only hides
 * them from pickers. Deleted ones come back with null names, which the page
 * labels "(person deleted)", "(location deleted)" and "(plan deleted)".
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {TieFilters} filters
 */
export async function listTies(db, ownerId, filters) {
  const { where, params } = tieFilterSql(ownerId, filters);
  const order = filters.sort === "oldest" ? ORDER_OLDEST : ORDER;
  const page = [...params, filters.page_size, (filters.page - 1) * filters.page_size];
  const pageOfIds = `SELECT t.id FROM ties t WHERE ${where} ${order} LIMIT ? OFFSET ?`;

  /** @type {D1Result<Record<string, any>>[]} */
  const [count, allCount, ties, ...links] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS total FROM ties t WHERE ${where}`).bind(...params),
    db.prepare("SELECT COUNT(*) AS total FROM ties WHERE owner_id = ?").bind(ownerId),
    db.prepare(`${TIE_COLUMNS} WHERE ${where} ${order} LIMIT ? OFFSET ?`).bind(...page),
    ...linkStatements(db, pageOfIds, page),
  ]);
  return {
    ties: assembleTies(ties.results, links[0].results, links[1].results, links[2].results),
    total: /** @type {number} */ (count.results[0].total),
    all_total: /** @type {number} */ (allCount.results[0].total),
    page: filters.page,
    page_size: filters.page_size,
  };
}

/**
 * One of my ties, as listTies gives them, or null if I have no such tie.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 */
export async function getTie(db, ownerId, id) {
  const params = [id, ownerId];
  /** @type {D1Result<Record<string, any>>[]} */
  const [ties, ...links] = await db.batch([
    db.prepare(`${TIE_COLUMNS} WHERE t.id = ? AND t.owner_id = ?`).bind(...params),
    ...linkStatements(db, "SELECT id FROM ties WHERE id = ? AND owner_id = ?", params),
  ]);
  return assembleTies(ties.results, links[0].results, links[1].results, links[2].results)[0] ?? null;
}

// A tie's own fields, its location's name and how many photos it has, for `ties t`.
// Exported for the test that keeps format 2's rows (store/queries/ties.js) the same.
export const TIE_COLUMNS = `
  SELECT t.id, t.title, t.tie_date, t.tie_type, t.duration_minutes, t.success_rating, t.notes, t.album_url, t.created_at, t.updated_at,
         t.location_id, t.location_deleted, l.name AS location_name,
         t.workshop_id, w.title AS workshop_title,
         (SELECT COUNT(*) FROM media m WHERE m.tie_id = t.id) AS photo_count,
         (SELECT COUNT(*) FROM media m WHERE m.tie_id = t.id) + (SELECT COUNT(*) FROM drawings d WHERE d.tie_id = t.id)
           + (SELECT COUNT(*) FROM poses p WHERE p.tie_id = t.id) AS visual_count
    FROM ties t
    LEFT JOIN locations l ON l.id = t.location_id
    LEFT JOIN workshops w ON w.id = t.workshop_id`;

/**
 * The participants, plans and tags of the ties whose ids the subquery picks.
 * Each link row's own id is included so the edit form can keep a deleted
 * person or plan.
 * @param {D1Database} db
 * @param {string} tieIds SQL selecting tie ids, with ? for params
 * @param {unknown[]} params
 */
function linkStatements(db, tieIds, params) {
  return [
    db.prepare(
      `SELECT tp.id, tp.tie_id, tp.person_id, pe.name AS person_name, tp.role
         FROM tie_participants tp
         LEFT JOIN people pe ON pe.id = tp.person_id
        WHERE tp.tie_id IN (${tieIds})
        ORDER BY pe.name COLLATE NOCASE`
    ).bind(...params),
    db.prepare(
      `SELECT tpl.id, tpl.tie_id, tpl.plan_id, p.title AS plan_title, tpl.plan_version
         FROM tie_plans tpl
         LEFT JOIN plans p ON p.id = tpl.plan_id
        WHERE tpl.tie_id IN (${tieIds})
        ORDER BY p.title COLLATE NOCASE`
    ).bind(...params),
    db.prepare(
      `SELECT tt.tie_id, tg.name
         FROM tie_tags tt
         JOIN tags tg ON tg.id = tt.tag_id
        WHERE tt.tie_id IN (${tieIds})
        ORDER BY tg.name COLLATE NOCASE`
    ).bind(...params),
  ];
}

/**
 * Nests each tie's participants, plans and tag names under it. Pure.
 * @param {Record<string, any>[]} ties
 * @param {Record<string, any>[]} participants rows with a tie_id
 * @param {Record<string, any>[]} plans rows with a tie_id
 * @param {Record<string, any>[]} [tags] rows with a tie_id and name
 */
export function assembleTies(ties, participants, plans, tags = []) {
  const byId = new Map();
  for (const tie of ties) {
    byId.set(tie.id, { ...tie, participants: [], plans: [], tags: [] });
  }
  for (const { tie_id, ...p } of participants) byId.get(tie_id)?.participants.push(p);
  for (const { tie_id, ...p } of plans) byId.get(tie_id)?.plans.push(p);
  for (const { tie_id, name } of tags) byId.get(tie_id)?.tags.push(name);
  return [...byId.values()];
}

/**
 * Adds a tie with its participants, plans and tags in one batch (one
 * transaction), so a bad link saves nothing, not even a new tag. The database's ownership triggers reject links
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
      `INSERT INTO ties (id, owner_id, title, tie_date, tie_type, location_id, workshop_id, duration_minutes, success_rating,
                         notes, album_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, ownerId, tie.title, tie.tie_date, tie.tie_type, tie.location_id, tie.workshop_id, tie.duration_minutes,
      tie.success_rating, tie.notes, tie.album_url),
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
  statements.push(...await tagStatements(db, ownerId, "tie", id, tie.tags));
  await db.batch(statements);
  return id;
}

/**
 * Saves edits to one of my ties, in one batch: its fields, and its people,
 * plans and tags replaced by the form's. What carries over:
 * - a person kept in the same role keeps their link row, with any ratings
 *   and notes on it (only an import sets those);
 * - a plan kept keeps the version this tie recorded; added ones get the
 *   plan's current version, as when logging a tie;
 * - deleted people and plans, and a deleted location, stay only if listed in
 *   keep_deleted.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @param {import("./parse.js").TieInput & { keep_deleted: import("./parse.js").KeptDeleted }} tie
 * @returns {Promise<boolean>} false if I have no such tie
 */
export async function updateTie(db, ownerId, id, tie) {
  const mine = await db.prepare("SELECT 1 FROM ties WHERE id = ? AND owner_id = ?").bind(id, ownerId).first();
  if (!mine) return false;
  const keep = tie.keep_deleted;
  // The link statements are scoped to my ties too, so they could never touch
  // someone else's tie even without the check above.
  const myTie = "tie_id = ? AND tie_id IN (SELECT id FROM ties WHERE owner_id = ?)";
  const personKeys = JSON.stringify(tie.participants.map((p) => `${p.person_id}|${p.role}`));

  const statements = [
    // No location: keep the "(location deleted)" mark only if asked to.
    db.prepare(
      `UPDATE ties SET title = ?, tie_date = ?, tie_type = ?, location_id = ?,
              location_deleted = CASE WHEN ? IS NULL AND ? THEN location_deleted ELSE 0 END,
              workshop_id = ?, duration_minutes = ?, success_rating = ?, notes = ?, album_url = ?, updated_at = ${NOW}
        WHERE id = ? AND owner_id = ?`
    ).bind(tie.title, tie.tie_date, tie.tie_type, tie.location_id, tie.location_id, keep.location ? 1 : 0, tie.workshop_id,
      tie.duration_minutes, tie.success_rating, tie.notes, tie.album_url, id, ownerId),
    db.prepare(
      `DELETE FROM tie_participants
        WHERE ${myTie}
          AND CASE WHEN person_id IS NULL THEN id NOT IN (SELECT value FROM json_each(?))
                   ELSE person_id || '|' || role NOT IN (SELECT value FROM json_each(?)) END`
    ).bind(id, ownerId, JSON.stringify(keep.participants), personKeys),
    ...tie.participants.map((p) =>
      db.prepare(
        `INSERT INTO tie_participants (id, tie_id, person_id, role) VALUES (?, ?, ?, ?)
         ON CONFLICT (tie_id, person_id, role) DO NOTHING`
      ).bind(crypto.randomUUID(), id, p.person_id, p.role)),
    db.prepare(
      `DELETE FROM tie_plans
        WHERE ${myTie}
          AND CASE WHEN plan_id IS NULL THEN id NOT IN (SELECT value FROM json_each(?))
                   ELSE plan_id NOT IN (SELECT value FROM json_each(?)) END`
    ).bind(id, ownerId, JSON.stringify(keep.plans), JSON.stringify(tie.plan_ids)),
    ...tie.plan_ids.map((planId) =>
      db.prepare(
        `INSERT INTO tie_plans (id, tie_id, plan_id, plan_version)
         VALUES (?, ?, ?, (SELECT version FROM plans WHERE id = ? AND owner_id = ?))
         ON CONFLICT (tie_id, plan_id) DO NOTHING`
      ).bind(crypto.randomUUID(), id, planId, planId, ownerId)),
    db.prepare(`DELETE FROM tie_tags WHERE ${myTie}`).bind(id, ownerId),
    ...await tagStatements(db, ownerId, "tie", id, tie.tags),
  ];
  await db.batch(statements);
  return true;
}

/**
 * Deletes one of my ties for good. Its links to people, plans and tags go
 * with it (cascade), and its photos' rows; the people, plans and tags
 * themselves stay. The caller deletes the photos' files.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<string[] | null>} the ids of the photos it had, or null
 *   if I have no such tie
 */
export async function deleteTie(db, ownerId, id) {
  const [media, result] = await db.batch([
    mediaOfStatement(db, ownerId, "tie_id", id),
    db.prepare("DELETE FROM ties WHERE id = ? AND owner_id = ?").bind(id, ownerId),
  ]);
  if (result.meta.changes === 0) return null;
  return media.results.map((r) => /** @type {{ id: string }} */ (r).id);
}

/**
 * What a keyword is searched in, for every tie of mine: its title, its
 * notes (encrypted: the crypto Worker opens them) and its plans' titles.
 * @param {D1Database} db
 * @param {string} ownerId
 * @returns {Promise<{ id: string, title: string | null, notes: string | null, plan_titles: string[] }[]>}
 */
export async function searchIndex(db, ownerId) {
  const { results } = await db.prepare(
    `SELECT t.id, t.title, t.notes,
            (SELECT json_group_array(p.title) FROM tie_plans tpl JOIN plans p ON p.id = tpl.plan_id
              WHERE tpl.tie_id = t.id) AS plan_titles
       FROM ties t WHERE t.owner_id = ?`
  ).bind(ownerId).all();
  return results.map((/** @type {any} */ r) => ({ ...r, plan_titles: JSON.parse(r.plan_titles) }));
}
