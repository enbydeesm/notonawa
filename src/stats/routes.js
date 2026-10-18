// Routes for the analytics views.

import { json, readJson } from "../http.js";
import { parseStatsFilters } from "./parse.js";
import { statsTies } from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleStats(request, env, user, url) {
  // POST /api/stats/ties
  //   body { from, to, role, person_ids, location_ids, tag_ids } (all optional)
  //   -> { ties: [{ id, tie_date, tie_type, duration_minutes, success_rating,
  //        location_id, location_deleted, location_name,
  //        participants: [{ person_id, person_name, is_self, role }] }] }:
  //   my ties in the date range, oldest first, where my own profile took
  //   part in the role ("top", "bottom", "self_tie", "spotter",
  //   "photographer"; "all" or left out: every tie), with any of
  //   the people, at any of the locations, and with any of the tags. Only
  //   what the analytics count; the page does the counting. A POST, as the
  //   filters can be long.
  if (url.pathname === "/api/stats/ties") {
    if (request.method !== "POST") return null;
    return json(await statsTies(env.DB, user.id, parseStatsFilters(await readJson(request))));
  }
  return null;
}
