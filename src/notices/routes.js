// Routes for notices: messages from us shown as banners in the app.

import { json, noContent, notFound } from "../http.js";
import { activeNotices, dismissNotice } from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

const DISMISS_PATH = /^\/api\/notices\/([^/]+)\/dismiss$/;

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleNotices(request, env, user, url) {
  // GET /api/notices -> [{ id, message, level, link, starts_at }]: the
  //   notices for me (or everyone) showing now that I haven't dismissed.
  if (url.pathname === "/api/notices" && request.method === "GET") {
    return json(await activeNotices(env.DB, user.id));
  }

  // POST /api/notices/:id/dismiss -> 204: stops showing me that notice.
  const dismiss = url.pathname.match(DISMISS_PATH);
  if (dismiss && request.method === "POST") {
    return (await dismissNotice(env.DB, user.id, decodeURIComponent(dismiss[1]))) ? noContent() : notFound();
  }
  return null;
}
