// The release-day script's SQL (scripts/release-cleanup.mjs, run once after
// the release's deploy): which accounts are empty, making them format 2
// without a conversion, and deleting format 1's connections. Pure: the SQL
// text only, so a test runs it against D1.
//
// An empty account is a format 1 one not converting, with nothing in its
// journal: no ties, plans, workshops, locations, tags, photos, drawings,
// poses, presets or connections; its "Me" with nothing filled in (not even
// renamed); no role names of its own and no saved default body. Its first
// unlock as format 2 makes its sealed "Me", settings and identity key, as a
// sign-up does (store/v2/journal.js).
//
// The check is part of the UPDATE itself, so an account that gains a tie
// while the script runs is either seen with it (and left alone) or made
// format 2 first, after which format 1's routes refuse the tie (src/format.js).

const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

/** The journal tables an empty account has nothing in, each by its owner. */
const OWNED = ["ties", "plans", "workshops", "locations", "tags", "media", "drawings", "poses", "pose_presets", "connection_offers"];

/** Whether users u is empty: SQL for a WHERE. */
export const EMPTY = `u.format = 1 AND u.converting_since IS NULL
  AND u.top_label IS NULL AND u.bottom_label IS NULL AND u.default_shape IS NULL
  ${OWNED.map((t) => `AND NOT EXISTS (SELECT 1 FROM ${t} x WHERE x.owner_id = u.id)`).join("\n  ")}
  AND NOT EXISTS (SELECT 1 FROM connections c WHERE c.owner_id = u.id OR c.peer_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM people p WHERE p.owner_id = u.id AND (p.is_self = 0 OR p.name <> 'Me'
        OR p.pronouns IS NOT NULL OR p.notes IS NOT NULL OR p.default_role IS NOT NULL OR p.is_educator = 1
        OR p.based_in IS NOT NULL OR p.aliases IS NOT NULL OR p.about IS NOT NULL OR p.about_shared_on IS NOT NULL
        OR p.archived_at IS NOT NULL OR p.connection_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM profile_notes n WHERE n.person_id = p.id)))`;

/** How many accounts are empty now (--dry-run). */
export const COUNT_SQL = `SELECT COUNT(*) AS n FROM users u WHERE ${EMPTY}`;

/** Makes the empty accounts format 2, giving their ids. */
export const MARK_SQL = `UPDATE users AS u SET format = 2, converted_at = ${NOW}
  WHERE ${EMPTY}
  RETURNING id`;

/**
 * Deletes the plain "Me" rows of format 2 accounts: what an empty account
 * had left (a converted one has no format 1 rows). Safe to run again.
 */
export const DELETE_ME_SQL = `DELETE FROM people
  WHERE is_self = 1 AND owner_id IN (SELECT id FROM users WHERE format = 2)`;

/** How many format 1 connection rows and offers to connect there are (--dry-run). */
export const CONNECTIONS_COUNT_SQL = `SELECT (SELECT COUNT(*) FROM connections) AS connections,
  (SELECT COUNT(*) FROM connection_offers) AS offers`;

/**
 * Stops old invites offering to connect: one marked to connect would
 * otherwise make a new offer (connection_offers) each time it's opened.
 */
export const STOP_INVITE_OFFERS_SQL = "UPDATE shares SET connect = 0 WHERE connect = 1";

/** Deletes every offer to connect (format 1's, made by opening an invite). */
export const DELETE_OFFERS_SQL = "DELETE FROM connection_offers";

/**
 * Deletes every format 1 connection, both sides. The person each was on
 * keeps their card, unlinked (people.connection_id's foreign key sets it to
 * NULL). Safe to run again.
 */
export const DELETE_CONNECTIONS_SQL = "DELETE FROM connections";
