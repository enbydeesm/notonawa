// The encrypted fields: notes and descriptions, sealed in the browser
// (public/js/crypto/fields.js has the same list; a unit test keeps them in
// step). Table and column names used in SQL only come from here.

/** @type {Record<string, string[]>} */
export const ENCRYPTED_COLUMNS = {
  ties: ["notes"],
  tie_participants: ["notes"],
  people: ["notes"],
  profile_notes: ["description"],
  locations: ["notes"],
  plans: ["description", "notes"],
};

/**
 * How to keep a query on each table to one owner's rows (?1 is the owner):
 * directly, or through the row that owns it.
 * @type {Record<string, string>}
 */
export const OWNER_SCOPE = {
  ties: "owner_id = ?1",
  tie_participants: "tie_id IN (SELECT id FROM ties WHERE owner_id = ?1)",
  people: "owner_id = ?1",
  profile_notes: "person_id IN (SELECT id FROM people WHERE owner_id = ?1)",
  locations: "owner_id = ?1",
  plans: "owner_id = ?1",
};

// A value that's still plain text: not empty, and not sealed. (LIKE ignores
// case, so "E1." counts as sealed too; the browser never writes that.)
/** @param {string} column */
export const isPlain = (column) => `(${column} IS NOT NULL AND ${column} NOT LIKE 'e1.%')`;
