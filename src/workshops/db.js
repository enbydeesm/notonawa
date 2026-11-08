// Database queries for workshops.

import { tagStatements, clearTagsStatement } from "../tags/db.js";
import { NOW } from "../sql.js";
import { mediaOfStatement } from "../media/db.js";

/** @typedef {import("./parse.js").WorkshopInput} WorkshopInput */

// Newest first; same-day ones by when they were logged, then id, so the
// order never shifts.
const ORDER = "ORDER BY w.start_date DESC, w.created_at DESC, w.id DESC";

// A workshop's own fields, its location's name and how many photos it has, for `workshops w`.
const WORKSHOP_COLUMNS = `
  SELECT w.id, w.title, w.start_date, w.end_date, w.attendee_count, w.rating,
         w.difficulty, w.rating_content, w.rating_teaching, w.rating_value, w.cost, w.event_url,
         w.description, w.notes, w.album_url, w.created_at, w.updated_at,
         w.location_id, w.location_deleted, l.name AS location_name,
         (SELECT COUNT(*) FROM media m WHERE m.workshop_id = w.id) AS photo_count
    FROM workshops w
    LEFT JOIN locations l ON l.id = w.location_id`;

/**
 * The people and tags of the workshops whose ids the subquery picks. Each
 * person row's own id is included so the edit form can keep a deleted one.
 * @param {D1Database} db
 * @param {string} workshopIds SQL selecting workshop ids, with ? for params
 * @param {unknown[]} params
 */
function linkStatements(db, workshopIds, params) {
  return [
    db.prepare(
      `SELECT wp.id, wp.workshop_id, wp.person_id, pe.name AS person_name, wp.kind, wp.role
         FROM workshop_people wp
         LEFT JOIN people pe ON pe.id = wp.person_id
        WHERE wp.workshop_id IN (${workshopIds})
        ORDER BY pe.name COLLATE NOCASE`
    ).bind(...params),
    db.prepare(
      `SELECT wt.workshop_id, tg.name
         FROM workshop_tags wt
         JOIN tags tg ON tg.id = wt.tag_id
        WHERE wt.workshop_id IN (${workshopIds})
        ORDER BY tg.name COLLATE NOCASE`
    ).bind(...params),
    // The plans and ties linked to it (migration 0030): plans first, A-Z,
    // then ties, oldest first. A tie's title can be empty: its date stands
    // in for it on the page.
    db.prepare(
      `SELECT workshop_id, kind, id, title, date FROM (
         SELECT p.workshop_id, 'plan' AS kind, p.id, p.title, NULL AS date, 0 AS k, p.title COLLATE NOCASE AS o
           FROM plans p WHERE p.workshop_id IN (${workshopIds})
         UNION ALL
         SELECT t.workshop_id, 'tie', t.id, t.title, t.tie_date, 1, t.tie_date || t.created_at
           FROM ties t WHERE t.workshop_id IN (${workshopIds}))
        ORDER BY k, o`
    ).bind(...params, ...params),
  ];
}

/**
 * Nests each workshop's educators, participants, tag names and linked plans
 * and ties under it. Pure.
 * @param {Record<string, any>[]} workshops
 * @param {Record<string, any>[]} people rows with a workshop_id and kind
 * @param {Record<string, any>[]} tags rows with a workshop_id and name
 * @param {Record<string, any>[]} [linked] rows with a workshop_id, kind, id, title and date
 */
export function assembleWorkshops(workshops, people, tags, linked = []) {
  const byId = new Map();
  for (const w of workshops) byId.set(w.id, { ...w, educators: [], participants: [], tags: [], linked: [] });
  for (const { workshop_id, ...item } of linked) byId.get(workshop_id)?.linked.push(item);
  for (const { workshop_id, kind, ...p } of people) {
    byId.get(workshop_id)?.[kind === "educator" ? "educators" : "participants"].push(p);
  }
  for (const { workshop_id, name } of tags) byId.get(workshop_id)?.tags.push(name);
  return [...byId.values()];
}

/**
 * All my workshops, newest first, each with its location, educators,
 * participants and tags (description and notes still sealed). There are
 * few enough to send at once: the page searches them itself. Archived
 * people and locations still show; deleted ones come back with null names.
 * @param {D1Database} db
 * @param {string} ownerId
 */
export async function listWorkshops(db, ownerId) {
  const params = [ownerId];
  /** @type {D1Result<Record<string, any>>[]} */
  const [workshops, people, tags, linked] = await db.batch([
    db.prepare(`${WORKSHOP_COLUMNS} WHERE w.owner_id = ? ${ORDER}`).bind(...params),
    ...linkStatements(db, "SELECT id FROM workshops WHERE owner_id = ?", params),
  ]);
  return assembleWorkshops(workshops.results, people.results, tags.results, linked.results);
}

/**
 * One of my workshops, as listWorkshops gives them, or null.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 */
export async function getWorkshop(db, ownerId, id) {
  const params = [id, ownerId];
  /** @type {D1Result<Record<string, any>>[]} */
  const [workshops, people, tags, linked] = await db.batch([
    db.prepare(`${WORKSHOP_COLUMNS} WHERE w.id = ? AND w.owner_id = ?`).bind(...params),
    ...linkStatements(db, "SELECT id FROM workshops WHERE id = ? AND owner_id = ?", params),
  ]);
  return assembleWorkshops(workshops.results, people.results, tags.results, linked.results)[0] ?? null;
}

/**
 * Statements adding a workshop's people.
 * @param {D1Database} db
 * @param {string} workshopId
 * @param {WorkshopInput["people"]} people
 */
function peopleStatements(db, workshopId, people) {
  return people.map((p) =>
    db.prepare("INSERT INTO workshop_people (id, workshop_id, person_id, kind, role) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), workshopId, p.person_id, p.kind, p.role));
}

/**
 * Adds a workshop with its people and tags in one batch (one transaction),
 * so a bad link saves nothing, not even a new tag. The ownership triggers
 * reject links to other users' items.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {WorkshopInput} w
 * @returns {Promise<string>} the new id
 */
export async function insertWorkshop(db, ownerId, w) {
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT INTO workshops (id, owner_id, title, start_date, end_date, location_id, attendee_count, rating,
                              difficulty, rating_content, rating_teaching, rating_value, cost, event_url,
                              description, notes, album_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, ownerId, w.title, w.start_date, w.end_date, w.location_id, w.attendee_count, w.rating,
      w.difficulty, w.rating_content, w.rating_teaching, w.rating_value, w.cost, w.event_url,
      w.description, w.notes, w.album_url),
    ...peopleStatements(db, id, w.people),
    ...await tagStatements(db, ownerId, "workshop", id, w.tags),
  ]);
  return id;
}

/**
 * Saves edits to one of my workshops, in one batch: its fields, and its
 * people and tags replaced by the form's. Deleted people, and a deleted
 * location, stay only if listed in keep_deleted. (A person's link row holds
 * nothing but its kind and role, so the rest are simply made again.)
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @param {WorkshopInput & { keep_deleted: import("./parse.js").KeptDeleted }} w
 * @returns {Promise<boolean>} false if I have no such workshop
 */
export async function updateWorkshop(db, ownerId, id, w) {
  const mine = await db.prepare("SELECT 1 FROM workshops WHERE id = ? AND owner_id = ?").bind(id, ownerId).first();
  if (!mine) return false;
  const keep = w.keep_deleted;
  // Scoped to my workshops too, so they could never touch someone else's.
  const myWorkshop = "workshop_id = ? AND workshop_id IN (SELECT id FROM workshops WHERE owner_id = ?)";
  await db.batch([
    // No location: keep the "(location deleted)" mark only if asked to.
    db.prepare(
      `UPDATE workshops SET title = ?, start_date = ?, end_date = ?, location_id = ?,
              location_deleted = CASE WHEN ? IS NULL AND ? THEN location_deleted ELSE 0 END,
              attendee_count = ?, rating = ?, difficulty = ?, rating_content = ?, rating_teaching = ?,
              rating_value = ?, cost = ?, event_url = ?, description = ?, notes = ?, album_url = ?, updated_at = ${NOW}
        WHERE id = ? AND owner_id = ?`
    ).bind(w.title, w.start_date, w.end_date, w.location_id, w.location_id, keep.location ? 1 : 0,
      w.attendee_count, w.rating, w.difficulty, w.rating_content, w.rating_teaching, w.rating_value, w.cost, w.event_url,
      w.description, w.notes, w.album_url, id, ownerId),
    db.prepare(
      `DELETE FROM workshop_people
        WHERE ${myWorkshop}
          AND (person_id IS NOT NULL OR id NOT IN (SELECT value FROM json_each(?)))`
    ).bind(id, ownerId, JSON.stringify(keep.people)),
    ...peopleStatements(db, id, w.people),
    clearTagsStatement(db, ownerId, "workshop", id),
    ...await tagStatements(db, ownerId, "workshop", id, w.tags),
  ]);
  return true;
}

/** The tables a workshop's links are on (migration 0030). */
export const LINKED_KINDS = /** @type {const} */ ({ tie: "ties", plan: "plans" });

/**
 * Links one of my ties or plans to one of my workshops, or (workshopId
 * null) unlinks it from the one given as from. A tie or plan has one
 * workshop: linking it moves it from any other.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {{ kind: "tie" | "plan", id: string, workshopId: string | null, from?: string }} link
 * @returns {Promise<boolean>} false if I have no such workshop, tie or plan
 *   (or, unlinking, it isn't on that workshop)
 */
export async function setWorkshopLink(db, ownerId, { kind, id, workshopId, from }) {
  const table = LINKED_KINDS[kind];
  const workshop = workshopId ?? from;
  const mine = await db.prepare("SELECT 1 FROM workshops WHERE id = ? AND owner_id = ?").bind(workshop, ownerId).first();
  if (!mine) return false;
  const result = workshopId
    ? await db.prepare(`UPDATE ${table} SET workshop_id = ?, updated_at = ${NOW} WHERE id = ? AND owner_id = ?`)
      .bind(workshopId, id, ownerId).run()
    : await db.prepare(`UPDATE ${table} SET workshop_id = NULL, updated_at = ${NOW} WHERE id = ? AND owner_id = ? AND workshop_id = ?`)
      .bind(id, ownerId, from).run();
  return result.meta.changes > 0;
}

/**
 * Deletes one of my workshops for good. Its links go with it (cascade), and
 * its photos' rows; the people, location and tags stay. The caller deletes
 * the photos' files.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<string[] | null>} the ids of the photos it had, or null
 *   if I have no such workshop
 */
export async function deleteWorkshop(db, ownerId, id) {
  const [media, result] = await db.batch([
    mediaOfStatement(db, ownerId, "workshop_id", id),
    db.prepare("DELETE FROM workshops WHERE id = ? AND owner_id = ?").bind(id, ownerId),
  ]);
  if (result.meta.changes === 0) return null;
  return media.results.map((r) => /** @type {{ id: string }} */ (r).id);
}
