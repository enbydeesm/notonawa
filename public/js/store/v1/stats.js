// The ties Analytics and the Calendar count, through today's API (format
// 1). See store/index.js.

import { api } from "../../api.js";

/**
 * The ties in a date range, with only what the counting needs, filtered by
 * my role and by any of the chosen people, locations and tags.
 * @param {Record<string, unknown>} filters as src/stats/parse.js reads them
 * @returns {Promise<import("../../stats.js").StatsTie[]>}
 */
export async function statsTies(filters) {
  return (await api("/api/stats/ties", { method: "POST", body: filters })).ties;
}
