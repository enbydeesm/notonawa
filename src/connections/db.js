// Database queries for connections. Each account has its own row of a
// connection (migration 0026), so everything here is scoped to owner_id;
// the other account is reached only through peer_id, which never leaves
// the server.

import { NOW } from "../sql.js";
import { OFFER_LIFETIME } from "./parse.js";

/**
 * My side of a connection, as GET /api/connections lists it: the label
 * still sealed, and which of my people it's on (null: none).
 * @typedef {{
 *   id: string, invited: number, label: string | null, answered: number, created_at: string, person_id: string | null,
 * }} ConnectionRow
 */

// A live offer, not one of my own invites'. ?1 is me, ?2 the token's hash.
const LIVE_OFFER = `o.token_hash = ?2 AND o.expires_at > ${NOW} AND o.owner_id <> ?1`;

/**
 * My row of a connection with this account, if we're connected.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} peerId
 * @returns {Promise<string | null>}
 */
export async function connectionWith(db, ownerId, peerId) {
  const row = await db.prepare("SELECT id FROM connections WHERE owner_id = ? AND peer_id = ?").bind(ownerId, peerId).first();
  return /** @type {string | null} */ (row?.id ?? null);
}

/**
 * Keeps an offer to connect, for whoever just opened an invite.
 * @param {D1Database} db
 * @param {string} tokenHash
 * @param {string} inviterId the invite's owner
 * @param {string | null} label the invite's sealed name
 */
export async function insertOffer(db, tokenHash, inviterId, label) {
  await db.prepare(
    `INSERT INTO connection_offers (token_hash, owner_id, label, expires_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '${OFFER_LIFETIME}'))`
  ).bind(tokenHash, inviterId, label).run();
}

/**
 * My connections, newest first.
 * @param {D1Database} db
 * @param {string} ownerId
 * @returns {Promise<ConnectionRow[]>}
 */
export async function listConnections(db, ownerId) {
  const { results } = await db.prepare(
    `SELECT c.id, c.invited, c.label, c.answered, c.created_at,
            (SELECT p.id FROM people p WHERE p.connection_id = c.id) AS person_id
       FROM connections c WHERE c.owner_id = ? ORDER BY c.created_at DESC, c.rowid DESC`
  ).bind(ownerId).all();
  return /** @type {ConnectionRow[]} */ (results);
}

/**
 * Whether this is one of my people other than me, who a connection can go on.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} personId
 */
export async function canLink(db, ownerId, personId) {
  const row = await db.prepare("SELECT 1 AS ok FROM people WHERE id = ? AND owner_id = ? AND is_self = 0").bind(personId, ownerId).first();
  return row !== null;
}

/**
 * Accepts an offer, in one batch: both sides' rows (or the connection we
 * already have), the link on my person (taken off any other of mine), and
 * the offer spent. Nothing changes if the offer has ended.
 * @param {D1Database} db
 * @param {string} ownerId me, accepting
 * @param {{ tokenHash: string, personId: string, label: string | null }} accept
 * @returns {Promise<string | null>} my row's id, or null if the offer has ended
 */
export async function acceptOffer(db, ownerId, { tokenHash, personId, label }) {
  // ?1 me, ?2 the token's hash, ?3 my person, ?4 my label, ?5 and ?6 the
  // new rows' ids. Each statement is given the ones up to the last it uses.
  const args = [ownerId, tokenHash, personId, label, crypto.randomUUID(), crypto.randomUUID()];
  const st = (/** @type {string} */ sql, /** @type {number} */ count) => db.prepare(sql).bind(...args.slice(0, count));
  const mine = `(SELECT c.id FROM connections c JOIN connection_offers o ON c.peer_id = o.owner_id
                  WHERE c.owner_id = ?1 AND ${LIVE_OFFER})`;
  const results = await db.batch([
    // The inviter's side: waiting for them to answer.
    st(`INSERT INTO connections (id, owner_id, peer_id, invited, label, answered)
        SELECT ?5, o.owner_id, ?1, 1, o.label, 0 FROM connection_offers o WHERE ${LIVE_OFFER}
        ON CONFLICT (owner_id, peer_id) DO NOTHING`, 5),
    st(`INSERT INTO connections (id, owner_id, peer_id, invited, label, answered)
        SELECT ?6, ?1, o.owner_id, 0, ?4, 1 FROM connection_offers o WHERE ${LIVE_OFFER}
        ON CONFLICT (owner_id, peer_id) DO NOTHING`, 6),
    st(`UPDATE people SET connection_id = NULL, updated_at = ${NOW}
         WHERE owner_id = ?1 AND id <> ?3 AND connection_id = ${mine}`, 3),
    st(`UPDATE people SET connection_id = ${mine}, updated_at = ${NOW}
         WHERE id = ?3 AND owner_id = ?1 AND EXISTS (SELECT 1 FROM connection_offers o WHERE ${LIVE_OFFER})`, 3),
    st(`SELECT ${mine} AS id`, 2),
    st(`DELETE FROM connection_offers AS o WHERE ${LIVE_OFFER} RETURNING token_hash`, 2),
  ]);
  if (results[5].results.length === 0) return null;
  return /** @type {string} */ (/** @type {any} */ (results[4].results[0]).id);
}

/**
 * Puts one of my connections on one of my people (taking it off any other),
 * and marks it answered.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id my row of the connection
 * @param {string} personId
 * @returns {Promise<boolean>} false if it isn't my connection
 */
export async function setPerson(db, ownerId, id, personId) {
  const results = await db.batch([
    db.prepare(`UPDATE people SET connection_id = NULL, updated_at = ${NOW} WHERE owner_id = ?1 AND connection_id = ?2 AND id <> ?3`)
      .bind(ownerId, id, personId),
    db.prepare(
      `UPDATE people SET connection_id = ?2, updated_at = ${NOW}
        WHERE id = ?3 AND owner_id = ?1 AND EXISTS (SELECT 1 FROM connections WHERE id = ?2 AND owner_id = ?1)`
    ).bind(ownerId, id, personId),
    db.prepare("UPDATE connections SET answered = 1 WHERE id = ? AND owner_id = ? RETURNING id").bind(id, ownerId),
  ]);
  return results[2].results.length > 0;
}

/**
 * Marks one of my connections answered (Not now, on the banner).
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<boolean>} false if it isn't mine
 */
export async function markAnswered(db, ownerId, id) {
  const row = await db.prepare("UPDATE connections SET answered = 1 WHERE id = ? AND owner_id = ? RETURNING id").bind(id, ownerId).first();
  return row !== null;
}

/**
 * Removes a connection: my row, and with it theirs (trg_connections_pair),
 * which takes it off both accounts' people. With removeAbout, the About on
 * their card for me is cleared first: it only ever came from my invites.
 * @param {D1Database} db
 * @param {string} ownerId
 * @param {string} id my row
 * @param {boolean} removeAbout
 * @returns {Promise<boolean>} false if it isn't mine
 */
export async function removeConnection(db, ownerId, id, removeAbout) {
  const statements = [
    db.prepare("DELETE FROM connections WHERE id = ? AND owner_id = ? RETURNING id").bind(id, ownerId),
  ];
  if (removeAbout) {
    statements.unshift(db.prepare(
      `UPDATE people SET about = NULL, about_shared_on = NULL, updated_at = ${NOW}
        WHERE connection_id = (SELECT theirs.id FROM connections c
                                 JOIN connections theirs ON theirs.owner_id = c.peer_id AND theirs.peer_id = c.owner_id
                                WHERE c.id = ?2 AND c.owner_id = ?1)`
    ).bind(ownerId, id));
  }
  const results = await db.batch(statements);
  return results[results.length - 1].results.length > 0;
}

/**
 * Deletes offers nobody accepted, for the daily clean-up.
 * @param {D1Database} db
 * @returns {Promise<number>} how many
 */
export async function deleteExpiredOffers(db) {
  const result = await db.prepare(`DELETE FROM connection_offers WHERE expires_at <= ${NOW}`).run();
  return result.meta.changes;
}
