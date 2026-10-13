// Routes for tags. Tags are created by saving a tie with them (POST /api/ties).

import { json, notFound, noContent } from "../http.js";
import { listTags, deleteTag } from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

const ITEM_PATH = /^\/api\/tags\/([^/]+)$/;

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleTags(request, env, user, url) {
  // GET /api/tags -> all my tags with how many ties use each, most recently
  //   used first; unused ones last, A–Z
  if (url.pathname === "/api/tags" && request.method === "GET") {
    return json(await listTags(env.DB, user.id));
  }

  // DELETE /api/tags/:id -> delete for good, removing it from every tie and plan
  const m = url.pathname.match(ITEM_PATH);
  if (m && request.method === "DELETE") {
    return (await deleteTag(env.DB, user.id, m[1])) ? noContent() : notFound();
  }

  return null;
}
