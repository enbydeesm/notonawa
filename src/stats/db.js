// Queries for the analytics views.

import { tieFilterSql } from "../ties/search.js";

/** @typedef {import("./parse.js").StatsFilters} StatsFilters */

/**
 * The ties the analytics count, oldest first, each with just what the
 * counting needs (no title, notes, plans or tags): its date, type, length,
 * rating, location (with its coordinates, for the map), and who took part in which role, with my own profile
 * marked (is_self). The counting happens on the device (public/js/stats.js),
 * so a chart can later list the ties behind a bar.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {StatsFilters} filters
 */
export async function statsTies(db, ownerId, filters) {
  const { where, params } = tieFilterSql(ownerId, filters);
  let clause = where;
  const allParams = [...params];
  // Ties where my own profile took part in one of the roles.
  if (filters.self_roles) {
    clause += `
    AND EXISTS (SELECT 1 FROM tie_participants tp JOIN people pe ON pe.id = tp.person_id
                 WHERE tp.tie_id = t.id AND pe.is_self = 1
                   AND tp.role IN (SELECT value FROM json_each(?)))`;
    allParams.push(JSON.stringify(filters.self_roles));
  }

  /** @type {D1Result<Record<string, any>>[]} */
  const [ties, participants] = await db.batch([
    db.prepare(
      `SELECT t.id, t.tie_date, t.tie_type, t.duration_minutes, t.success_rating,
              t.location_id, t.location_deleted, l.name AS location_name,
              l.latitude, l.longitude
         FROM ties t
         LEFT JOIN locations l ON l.id = t.location_id
        WHERE ${clause}
        ORDER BY t.tie_date, t.id`
    ).bind(...allParams),
    db.prepare(
      `SELECT tp.tie_id, tp.person_id, pe.name AS person_name, COALESCE(pe.is_self, 0) AS is_self, tp.role
         FROM tie_participants tp
         LEFT JOIN people pe ON pe.id = tp.person_id
        WHERE tp.tie_id IN (SELECT t.id FROM ties t WHERE ${clause})`
    ).bind(...allParams),
  ]);
  return { ties: assembleStatsTies(ties.results, participants.results) };
}

/**
 * Nests each tie's participants under it. Pure.
 * @param {Record<string, any>[]} ties
 * @param {Record<string, any>[]} participants rows with a tie_id
 */
export function assembleStatsTies(ties, participants) {
  const byId = new Map();
  for (const tie of ties) byId.set(tie.id, { ...tie, participants: [] });
  for (const { tie_id, ...p } of participants) {
    byId.get(tie_id)?.participants.push({ ...p, is_self: p.is_self === 1 });
  }
  return [...byId.values()];
}
