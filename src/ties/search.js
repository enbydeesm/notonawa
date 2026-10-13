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

  // Inclusive. Ties with no date never match a date range.
  if (filters.from) {
    clauses.push("t.tie_date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push("t.tie_date <= ?");
    params.push(filters.to);
  }

  // Keyword in the title, the notes, or a linked plan's title. LIKE ignores
  // case (for A–Z; SQLite doesn't fold accented letters).
  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    clauses.push(
      `(t.title LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM tie_plans tpl JOIN plans p ON p.id = tpl.plan_id
                    WHERE tpl.tie_id = t.id AND p.title LIKE ? ESCAPE '\\'))`
    );
    params.push(pattern, pattern, pattern);
  }

  return { where: clauses.join("\n    AND "), params };
}

/**
 * Makes % and _ in the search text match themselves rather than act as
 * LIKE wildcards.
 * @param {string} text
 */
export function escapeLike(text) {
  return text.replace(/[\\%_]/g, "\\$&");
}
