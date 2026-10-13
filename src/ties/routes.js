// Routes for ties.

import { json, readJson } from "../http.js";
import { parseTieInput, parseTieFilters } from "./parse.js";
import { listTies, insertTie } from "./db.js";

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
  if (url.pathname !== "/api/ties") return null;

  // GET /api/ties?person_id=&location_id=&from=&to=&q=&page=
  //   -> { ties, total, page, page_size }: one page of my ties matching the
  //   filters (all optional), newest tie date first, with location,
  //   participants and plans. person_id: ties with all of them;
  //   location_id: at any of them; q: in title, notes or a linked plan's title.
  if (request.method === "GET") {
    return json(await listTies(env.DB, user.id, parseTieFilters(url.searchParams)));
  }

  // POST /api/ties -> add a tie with its location, participants and plans
  if (request.method === "POST") {
    const tie = parseTieInput(await readJson(request));
    return json({ id: await insertTie(env.DB, user.id, tie) }, 201);
  }

  return null;
}
