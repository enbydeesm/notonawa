// The route for an item's visuals as one list: photos and videos, drawings
// and poses share one order, however the person arranges them.

import { BadInput, noContent, readJson } from "../http.js";
import { parseItem } from "../media/parse.js";
import { parseVisualOrder } from "./parse.js";
import { setVisualOrder } from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

/**
 * Returns a Response if the request is for this route, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleVisuals(request, env, user, url) {
  // PUT /api/visuals/order  body { tie_id | plan_id | workshop_id, order:
  //   [{ kind: "media" | "drawing" | "pose", id }] } -> puts an item's
  //   visuals in this order (every one of them, first to last)
  if (url.pathname !== "/api/visuals/order" || request.method !== "PUT") return null;
  const body = await readJson(request);
  const item = parseItem(body);
  if (!(await setVisualOrder(env.DB, user.id, item, parseVisualOrder(body.order)))) {
    throw new BadInput("The photos, drawings or poses have changed. Reload and try again.");
  }
  return noContent();
}
