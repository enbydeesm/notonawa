// Routes for ties.

import { json, notFound, noContent, readJson } from "../http.js";
import { parseTieInput, parseTieUpdate, parseTieFilters, RECENT_TYPES } from "./parse.js";
import { listTies, getTie, insertTie, updateTie, deleteTie, recentIds } from "./db.js";

// How many recent items the tie form's pickers show before anything is typed.
const RECENT_COUNT = 5;
const RECENT_PATH = new RegExp(`^/api/ties/recent/(${RECENT_TYPES.join("|")})$`);
const TIE_PATH = /^\/api\/ties\/([^/]+)$/;

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
  //   body { person_ids, location_ids, tag_ids, tag_match, from, to, q, page,
  //          page_size, sort }
  //   -> { ties, total, all_total, page, page_size }: one page of my ties
  //   matching the filters (all optional), newest tie date first (or oldest,
  //   with sort "oldest"), 20, 50 or 100 a page, with location, participants,
  //   plans and tags. total: how many match; all_total: how many I have. person_ids: ties with all of them;
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

  const one = url.pathname.match(TIE_PATH);
  if (one) {
    const id = one[1];
    // GET /api/ties/:id -> one of my ties, as in the search, for editing
    if (request.method === "GET") {
      const tie = await getTie(env.DB, user.id, id);
      return tie ? json(tie) : notFound();
    }
    // PUT /api/ties/:id -> save the whole edit form (as POST /api/ties, plus
    //   keep_deleted: the deleted people, plans and location to keep)
    if (request.method === "PUT") {
      const tie = parseTieUpdate(await readJson(request));
      return (await updateTie(env.DB, user.id, id, tie)) ? json({ id }) : notFound();
    }
    // DELETE /api/ties/:id -> delete it for good (its people, plans and tags stay)
    if (request.method === "DELETE") {
      return (await deleteTie(env.DB, user.id, id)) ? noContent() : notFound();
    }
    return null;
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
