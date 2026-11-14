// The ties Analytics and the Calendar count, over the journal in memory
// (format 2): the same as v1/stats.js (store/queries/ties.js's statsRows).

import { records, byId } from "./journal.js";
import { statsRows } from "../queries/ties.js";

/**
 * @param {Record<string, unknown>} filters as src/stats/parse.js reads them
 * @returns {Promise<import("../../stats.js").StatsTie[]>}
 */
export async function statsTies(filters) {
  return /** @type {any} */ (statsRows(records("tie"), byId(), filters));
}
