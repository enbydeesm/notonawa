// Database work for imports. Rows go in as JSON, one statement per table (per
// chunk; see import-plan.js jsonChunks), read back with json_each. A
// statement per row would run into D1's limit of 50 queries per request on
// the Free plan. Each request's statements run in one batch, so one
// transaction: a bad row saves nothing from that request.
//
// In every statement ?1 is the owner and ?2 the chunk's JSON. Column names
// are fixed here, never from the request. The ownership triggers still check
// every link (a person, location or plan id that isn't mine fails the batch).

import { NOW } from "../sql.js";
import { jsonChunks } from "./import-plan.js";

/** @typedef {import("./import-plan.js").Existing} Existing */
/** @typedef {Record<string, unknown>} Row */

/** A field of the current JSON row. @param {string} name */
const j = (name) => `j.value ->> '$.${name}'`;
/** A timestamp from the file, or now. @param {string} name */
const time = (name) => `COALESCE(${j(name)}, ${NOW})`;

// A tie this batch has just inserted (its id is new, so it exists only if
// it was inserted rather than skipped as a duplicate).
const TIE_INSERTED = `EXISTS (SELECT 1 FROM ties WHERE id = ${j("tie_id")} AND owner_id = ?1)`;

// A saved tie x's people, plans and tags as one text, built as linksKey
// (import-plan.js) builds it for the file's ties; the two must match.
// Ids are compared in byte order, which is how JavaScript sorts them too.
const LINKS_KEY = `
  COALESCE((SELECT group_concat(k, ',' ORDER BY k) FROM
             (SELECT COALESCE(person_id, '') || '|' || role AS k FROM tie_participants WHERE tie_id = x.id)), '')
  || ';' || COALESCE((SELECT group_concat(k, ',' ORDER BY k) FROM
             (SELECT COALESCE(plan_id, '') AS k FROM tie_plans WHERE tie_id = x.id)), '')
  || ';' || COALESCE((SELECT group_concat(tag_id, ',' ORDER BY tag_id) FROM tie_tags WHERE tie_id = x.id), '')`;

// My tie x is the same as the file's tie j in everything we can compare:
// date, title, type, location, duration, rating, people, plans and tags.
// (Not created_at: a CSV has none.) Not the notes: they're encrypted, so
// the page compares those itself (import-dedupe.js).
const SAME_BUT_NOTES = `
       x.owner_id = ?1 AND x.tie_date = ${j("tie_date")}
   AND x.title IS ${j("title")}
   AND x.tie_type IS ${j("tie_type")} AND x.location_id IS ${j("location_id")}
   AND x.location_deleted = ${j("location_deleted")}
   AND x.duration_minutes IS ${j("duration_minutes")} AND x.success_rating IS ${j("success_rating")}
   AND (${LINKS_KEY}) = ${j("links")}`;

const SQL = {
  tags: `INSERT INTO tags (id, owner_id, name)
         SELECT ${j("id")}, ?1, ${j("name")} FROM json_each(?2) j WHERE true
         ON CONFLICT (owner_id, name) DO NOTHING`,
  people: `INSERT INTO people (id, owner_id, name, pronouns, notes, is_self, default_role, archived_at, created_at, updated_at)
           SELECT ${j("id")}, ?1, ${j("name")}, ${j("pronouns")}, ${j("notes")}, ${j("is_self")}, ${j("default_role")},
                  ${j("archived_at")}, ${time("created_at")}, ${time("updated_at")}
             FROM json_each(?2) j`,
  // The people are new rows of mine (?1 isn't needed: profile notes have no owner).
  profileNotes: `INSERT INTO profile_notes (id, person_id, type, description, noted_on, is_current, created_at, updated_at)
                 SELECT ${j("id")}, ${j("person_id")}, ${j("type")}, ${j("description")}, ${j("noted_on")},
                        ${j("is_current")}, ${time("created_at")}, ${time("updated_at")}
                   FROM json_each(?2) j
                  WHERE EXISTS (SELECT 1 FROM people WHERE id = ${j("person_id")} AND owner_id = ?1)`,
  locations: `INSERT INTO locations (id, owner_id, name, notes, maps_url, latitude, longitude, is_default, archived_at, created_at, updated_at)
              SELECT ${j("id")}, ?1, ${j("name")}, ${j("notes")}, ${j("maps_url")},
                     ${j("latitude")}, ${j("longitude")}, ${j("is_default")}, ${j("archived_at")}, ${time("created_at")}, ${time("updated_at")}
                FROM json_each(?2) j`,
  plans: `INSERT INTO plans (id, owner_id, title, stage, plan_type, description, notes, est_difficulty, version, archived_at, created_at, updated_at)
          SELECT ${j("id")}, ?1, ${j("title")}, ${j("stage")}, ${j("plan_type")}, ${j("description")}, ${j("notes")},
                 ${j("est_difficulty")}, ${j("version")}, ${j("archived_at")}, ${time("created_at")}, ${time("updated_at")}
            FROM json_each(?2) j`,
  // Plans just inserted, so this isn't an edit: updated_at keeps the file's value.
  variations: `UPDATE plans SET variation_of = ${j("variation_of")}
                 FROM json_each(?2) j
                WHERE plans.id = ${j("id")} AND plans.owner_id = ?1`,
  planTags: `INSERT INTO plan_tags (plan_id, tag_id)
             SELECT ${j("plan_id")}, t.id FROM json_each(?2) j
               JOIN tags t ON t.owner_id = ?1 AND t.name = ${j("name")}`,
  // Exact duplicates of my ties are left out before this (the page sends
  // which to skip), so importing the same file twice, or again after a
  // failed batch, adds nothing twice.
  ties: `INSERT INTO ties (id, owner_id, title, tie_date, tie_type, location_id, location_deleted, duration_minutes, success_rating, notes, created_at, updated_at)
         SELECT ${j("id")}, ?1, ${j("title")}, ${j("tie_date")}, ${j("tie_type")}, ${j("location_id")}, ${j("location_deleted")},
                ${j("duration_minutes")}, ${j("success_rating")}, ${j("notes")}, ${time("created_at")}, ${time("updated_at")}
           FROM json_each(?2) j`,
  participants: `INSERT INTO tie_participants (id, tie_id, person_id, role, difficulty_rating, experience_rating, notes)
                 SELECT ${j("id")}, ${j("tie_id")}, ${j("person_id")}, ${j("role")},
                        ${j("difficulty_rating")}, ${j("experience_rating")}, ${j("notes")}
                   FROM json_each(?2) j WHERE ${TIE_INSERTED}`,
  // No version in the file (e.g. from a CSV): the plan's current one, as
  // when logging a tie. A deleted plan with no version: 1.
  tiePlans: `INSERT INTO tie_plans (id, tie_id, plan_id, plan_version)
             SELECT ${j("id")}, ${j("tie_id")}, ${j("plan_id")},
                    COALESCE(${j("plan_version")},
                             (SELECT version FROM plans WHERE id = ${j("plan_id")} AND owner_id = ?1), 1)
               FROM json_each(?2) j WHERE ${TIE_INSERTED}`,
  tieTags: `INSERT INTO tie_tags (tie_id, tag_id)
            SELECT ${j("tie_id")}, t.id FROM json_each(?2) j
              JOIN tags t ON t.owner_id = ?1 AND t.name = ${j("name")}
             WHERE ${TIE_INSERTED}`,
  candidates: `SELECT ${j("i")} AS i, x.id, x.notes FROM json_each(?2) j JOIN ties x ON ${SAME_BUT_NOTES}`,
};

/**
 * My people, locations, plans (title as name) and tags, for matching.
 * @param {D1Database} db
 * @param {string} ownerId
 * @returns {Promise<Existing>}
 */
export async function existingItems(db, ownerId) {
  const q = (/** @type {string} */ sql) => db.prepare(sql).bind(ownerId);
  const [people, locations, plans, tags] = /** @type {D1Result<any>[]} */ (await db.batch([
    q("SELECT id, name, is_self, archived_at FROM people WHERE owner_id = ?"),
    q("SELECT id, name, is_default, archived_at FROM locations WHERE owner_id = ?"),
    q("SELECT id, title AS name, archived_at FROM plans WHERE owner_id = ?"),
    q("SELECT id, name FROM tags WHERE owner_id = ?"),
  ]));
  return { people: people.results, locations: locations.results, plans: plans.results, tags: tags.results };
}

/**
 * Inserts the new people, locations, plans and tags, in one transaction.
 * Tags first (plans link to them), plans before their variations.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {ReturnType<typeof import("./import-plan.js").planItems>["rows"]} rows
 */
export async function insertItems(db, ownerId, rows) {
  await runBatch(db, [
    ...statements(db, SQL.tags, ownerId, rows.tags),
    ...statements(db, SQL.people, ownerId, rows.people),
    ...statements(db, SQL.profileNotes, ownerId, rows.profileNotes),
    ...statements(db, SQL.locations, ownerId, rows.locations),
    ...statements(db, SQL.plans, ownerId, rows.plans),
    ...statements(db, SQL.variations, ownerId, rows.variations),
    ...statements(db, SQL.planTags, ownerId, rows.planTags),
  ]);
}

/**
 * Inserts a batch of ties with their participants, plans and tags, in one
 * transaction.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {ReturnType<typeof import("./import-plan.js").planTies>["rows"]} rows
 * @returns {Promise<number>} how many ties were added
 */
export async function insertTies(db, ownerId, rows) {
  const tags = statements(db, SQL.tags, ownerId, rows.tags);
  const ties = statements(db, SQL.ties, ownerId, rows.ties);
  const results = await runBatch(db, [
    ...tags,
    ...ties,
    ...statements(db, SQL.participants, ownerId, rows.participants),
    ...statements(db, SQL.tiePlans, ownerId, rows.tiePlans),
    ...statements(db, SQL.tieTags, ownerId, rows.tieTags),
  ]);
  return results.slice(tags.length, tags.length + ties.length).reduce((sum, r) => sum + r.meta.changes, 0);
}

/**
 * Which of my ties each of these ties (by position) might duplicate: the
 * same in everything but the notes, with those notes (encrypted) for the
 * page to compare, and their ids (a skipped tie's photos go on the one it
 * duplicates).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {ReturnType<typeof import("./import-plan.js").planTies>["rows"]["ties"]} ties
 * @returns {Promise<{ i: number, id: string, notes: string | null }[]>}
 */
export async function duplicateCandidates(db, ownerId, ties) {
  const rows = ties.map((t, i) => ({ ...t, i }));
  const results = await runBatch(db, statements(db, SQL.candidates, ownerId, rows));
  return results.flatMap((r) => /** @type {{ i: number, id: string, notes: string | null }[]} */ (r.results));
}

/**
 * One statement per chunk of rows.
 * @param {D1Database} db
 * @param {string} sql
 * @param {string} ownerId
 * @param {Row[]} rows
 */
function statements(db, sql, ownerId, rows) {
  return jsonChunks(rows).map((chunk) => db.prepare(sql).bind(ownerId, chunk));
}

/**
 * @param {D1Database} db
 * @param {D1PreparedStatement[]} list
 */
async function runBatch(db, list) {
  return list.length ? db.batch(list) : [];
}
