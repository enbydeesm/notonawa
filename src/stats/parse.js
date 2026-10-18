// Parsing a stats request. Pure, so it's easy to test.

import { BadInput } from "../http.js";
import { parseTieFilters } from "../ties/parse.js";

/**
 * The roles the analytics filter offers (each the tie roles it matches;
 * since migration 0013 that's one role each).
 * @type {Record<string, string[]>}
 */
export const ROLE_GROUPS = {
  top: ["top"],
  bottom: ["bottom"],
  self_tie: ["self tie"],
  spotter: ["spotter"],
  photographer: ["photographer"],
};

/**
 * @typedef {import("../ties/parse.js").TieFilters & { self_roles: string[] | null }} StatsFilters
 *   self_roles: ties where my own profile ("this is me") took part in one of
 *   these roles; null for every tie.
 */

/**
 * The stats body: from / to (tie dates, inclusive; both optional, for all
 * time), role ("all", the default, or one of ROLE_GROUPS' names), and
 * person_ids, location_ids and tag_ids. Unlike the ties search, choosing
 * several people, locations or tags finds ties with ANY of them; different
 * kinds narrow the results together.
 * @param {Record<string, unknown>} body
 * @returns {StatsFilters}
 */
export function parseStatsFilters(body) {
  const filters = parseTieFilters({
    person_ids: body.person_ids,
    location_ids: body.location_ids,
    tag_ids: body.tag_ids,
    from: body.from,
    to: body.to,
  });
  return { ...filters, person_match: "any", tag_match: "any", self_roles: parseRole(body.role) };
}

/**
 * @param {unknown} value
 * @returns {string[] | null}
 */
function parseRole(value) {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  if (typeof value === "string" && Object.hasOwn(ROLE_GROUPS, value)) return ROLE_GROUPS[value];
  throw new BadInput(`Choose a role: all, ${Object.keys(ROLE_GROUPS).join(", ")}.`);
}
