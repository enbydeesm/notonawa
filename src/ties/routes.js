// Routes for ties.

import { json, readJson } from "../http.js";
import { parseTieInput, parseTieFilters, RECENT_TYPES } from "./parse.js";
import { listTies, insertTie, recentIds } from "./db.js";

// How many recent items the tie form's pickers show before anything is typed.
const RECENT_COUNT = 5;
const RECENT_PATH = new RegExp(`^/api/ties/recent/(${RECENT_TYPES.join("|")})$`);

/** @typedef {import("../auth/user.js").User} User */

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleTies(request, env, user, url) {
  // POST /api/ties/search
  //   body { person_ids, location_ids, tag_ids, tag_match, from, to, q, page }
  //   -> { ties, total, page, page_size }: one page of my ties matching the
  //   filters (all optional), newest tie date first, with location,
  //   participants and plans. person_ids: ties with all of them;
  //   location_ids: at any of them; tag_ids: with any of them, or all of
  //   them if tag_match is "all"; q: in title, notes or a linked plan's title.
  //   A POST, not a GET, so the keyword never appears in a URL, where it would
  //   end up in browser history and request logs.
  if (url.pathname === "/api/ties/search") {
    if (request.method !== "POST") return null;
    return json(await listTies(env.DB, user.id, parseTieFilters(await readJson(request))));
  }

  // GET /api/ties/recent/locations|people|plans -> ids of my active ones,
  //   most recently on a tie first (up to 5), for the tie form's pickers
  const recent = url.pathname.match(RECENT_PATH);
  if (recent) {
    if (request.method !== "GET") return null;
    const type = /** @type {import("./parse.js").RecentType} */ (recent[1]);
    return json(await recentIds(env.DB, user.id, type, RECENT_COUNT));
  }

  if (url.pathname !== "/api/ties") return null;

  // POST /api/ties -> add a tie with its type, location, participants, plans and
  //   tags (by name; new ones are created)
  if (request.method === "POST") {
    const tie = parseTieInput(await readJson(request));
    return json({ id: await insertTie(env.DB, user.id, tie) }, 201);
  }

  return null;
}
