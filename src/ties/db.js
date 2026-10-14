// Database queries for ties.

import { PAGE_SIZE } from "./parse.js";
import { tieFilterSql } from "./search.js";
import { tagNames } from "../tags/db.js";
import { matchTags } from "../tags/parse.js";

/** @typedef {import("./parse.js").TieInput} TieInput */
/** @typedef {import("./parse.js").TieFilters} TieFilters */

const ORDER = "ORDER BY t.tie_date DESC, t.created_at DESC, t.id";

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
 * One page of my ties that match the filters, newest tie date first, each
 * with its location, participants and plans, plus how many match in all.
 * Archived people, locations and plans still show here: archiving only hides
 * them from pickers. Deleted ones come back with null names, which the page
 * labels "(person deleted)", "(location deleted)" and "(plan deleted)".
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {TieFilters} filters
 */
export async function listTies(db, ownerId, filters) {
  const { where, params } = tieFilterSql(ownerId, filters);
  // created_at and id break ties between same-day ties, so the order (and
  // which page a tie lands on) never shifts between requests.
  const page = [...params, PAGE_SIZE, (filters.page - 1) * PAGE_SIZE];
  const pageOfIds = `SELECT t.id FROM ties t WHERE ${where} ${ORDER} LIMIT ? OFFSET ?`;

  /** @type {D1Result<Record<string, any>>[]} */
  const [count, ties, participants, plans] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS total FROM ties t WHERE ${where}`).bind(...params),
    db.prepare(
      `SELECT t.id, t.title, t.tie_date, t.tie_type, t.duration_minutes, t.success_rating, t.notes, t.created_at,
              t.location_id, t.location_deleted, l.name AS location_name
         FROM ties t
         LEFT JOIN locations l ON l.id = t.location_id
        WHERE ${where}
        ${ORDER}
        LIMIT ? OFFSET ?`
    ).bind(...page),
    db.prepare(
      `SELECT tp.tie_id, tp.person_id, pe.name AS person_name, tp.role
         FROM tie_participants tp
         LEFT JOIN people pe ON pe.id = tp.person_id
        WHERE tp.tie_id IN (${pageOfIds})
        ORDER BY pe.name COLLATE NOCASE`
    ).bind(...page),
    db.prepare(
      `SELECT tpl.tie_id, tpl.plan_id, p.title AS plan_title, tpl.plan_version
         FROM tie_plans tpl
         LEFT JOIN plans p ON p.id = tpl.plan_id
        WHERE tpl.tie_id IN (${pageOfIds})
        ORDER BY p.title COLLATE NOCASE`
    ).bind(...page),
  ]);
  return {
    ties: assembleTies(ties.results, participants.results, plans.results),
    total: /** @type {number} */ (count.results[0].total),
    page: filters.page,
    page_size: PAGE_SIZE,
  };
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
      `INSERT INTO ties (id, owner_id, title, tie_date, tie_type, location_id, duration_minutes, success_rating, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, ownerId, tie.title, tie.tie_date, tie.tie_type, tie.location_id, tie.duration_minutes, tie.success_rating, tie.notes),
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
  // Tags not matching one of mine (ignoring capitals) are created here. If the
  // same tag was created a moment ago elsewhere, DO NOTHING keeps that one, and
  // the link below finds it by name either way.
  const tags = tie.tags.length ? matchTags(await tagNames(db, ownerId), tie.tags) : [];
  for (const tag of tags) {
    if (tag.isNew) {
      statements.push(
        db.prepare("INSERT INTO tags (id, owner_id, name) VALUES (?, ?, ?) ON CONFLICT (owner_id, name) DO NOTHING")
          .bind(crypto.randomUUID(), ownerId, tag.name)
      );
    }
    statements.push(
      db.prepare("INSERT INTO tie_tags (tie_id, tag_id) SELECT ?, id FROM tags WHERE owner_id = ? AND name = ?")
        .bind(id, ownerId, tag.name)
    );
  }
  await db.batch(statements);
  return id;
}
