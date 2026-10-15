// Turns the list filters into a WHERE clause for `ties t`. Pure, so it's easy
// to test. Every value is bound with ?; only the fixed fragments below go into
// the SQL text.

/** @typedef {import("./parse.js").TieFilters} TieFilters */

/**
 * @param {string} ownerId
 * @param {TieFilters} filters
 * @returns {{ where: string, params: unknown[] }}
 */
export function tieFilterSql(ownerId, filters) {
  const clauses = ["t.owner_id = ?"];
  /** @type {unknown[]} */
  const params = [ownerId];

  // Ties with ALL the chosen people: count how many of them took part.
  // The ids go in as one JSON array so any number uses one parameter.
  if (filters.person_ids.length) {
    clauses.push(
      `(SELECT COUNT(DISTINCT tp.person_id) FROM tie_participants tp
         WHERE tp.tie_id = t.id AND tp.person_id IN (SELECT value FROM json_each(?))) = ?`
    );
    params.push(JSON.stringify(filters.person_ids), filters.person_ids.length);
  }

  // Ties at ANY of the chosen locations (a tie has only one).
  if (filters.location_ids.length) {
    clauses.push("t.location_id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(filters.location_ids));
  }

  // Ties with ANY of the chosen tags, or (tag_match "all") with ALL of them,
  // counted the same way as people.
  if (filters.tag_ids.length) {
    if (filters.tag_match === "all") {
      clauses.push(
        `(SELECT COUNT(DISTINCT tt.tag_id) FROM tie_tags tt
           WHERE tt.tie_id = t.id AND tt.tag_id IN (SELECT value FROM json_each(?))) = ?`
      );
      params.push(JSON.stringify(filters.tag_ids), filters.tag_ids.length);
    } else {
      clauses.push(
        `EXISTS (SELECT 1 FROM tie_tags tt
                  WHERE tt.tie_id = t.id AND tt.tag_id IN (SELECT value FROM json_each(?)))`
      );
      params.push(JSON.stringify(filters.tag_ids));
    }
  }

  // Inclusive. Every tie has a date (required since migration 0006).
  if (filters.from) {
    clauses.push("t.tie_date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push("t.tie_date <= ?");
    params.push(filters.to);
  }

  // The ties a keyword matched. The keyword never comes here: notes are
  // encrypted, so the search happens on the device (in the crypto Worker),
  // which sends the ids. The other filters, the sort and the paging stay here.
  if (filters.match_ids) {
    clauses.push("t.id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(filters.match_ids));
  }

  return { where: clauses.join("\n    AND "), params };
}
