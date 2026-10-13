// Routes for plans, people and locations: list, add, edit, archive, restore, delete.

import { BadInput, json, notFound, noContent, readJson } from "../http.js";
import { toFlag } from "../parse.js";
import { RESOURCES, RESOURCE_NAMES, parseFields, checkEdit } from "./config.js";
import * as db from "./db.js";

/** @typedef {import("./config.js").ResourceName} ResourceName */
/** @typedef {import("../auth/user.js").User} User */

const NAMES = RESOURCE_NAMES.join("|");
const LIST_PATH = new RegExp(`^/api/(${NAMES})$`);
const ITEM_PATH = new RegExp(`^/api/(${NAMES})/([^/]+)$`);
const ACTION_PATH = new RegExp(`^/api/(${NAMES})/([^/]+)/(archive|restore)$`);

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleResources(request, env, user, url) {
  const { method } = request;
  let m;

  // GET /api/:type            -> active items (for pages and pickers)
  // GET /api/:type?archived=1 -> archived items only
  // POST /api/:type           -> add
  if ((m = url.pathname.match(LIST_PATH))) {
    const name = /** @type {ResourceName} */ (m[1]);

    if (method === "GET") {
      const archived = url.searchParams.get("archived") === "1";
      return json(await db.listRows(env.DB, name, user.id, archived));
    }

    if (method === "POST") {
      const body = await readJson(request);
      const fields = parseFields(RESOURCES[name], body);
      const archiveNow = !!RESOURCES[name].archiveOnCreate && toFlag(body.archive_now) === 1;
      const id = await db.insertRow(env.DB, name, user.id, fields, archiveNow);
      return json({ id }, 201);
    }
  }

  // POST /api/:type/:id/archive -> hide from pickers and default lists
  // POST /api/:type/:id/restore -> un-archive
  if ((m = url.pathname.match(ACTION_PATH)) && method === "POST") {
    const name = /** @type {ResourceName} */ (m[1]);
    const row = m[3] === "archive"
      ? await db.archiveRow(env.DB, name, user.id, m[2])
      : await db.restoreRow(env.DB, name, user.id, m[2]);
    return row ? json(row) : notFound();
  }

  if ((m = url.pathname.match(ITEM_PATH))) {
    const name = /** @type {ResourceName} */ (m[1]);
    const id = m[2];

    // PUT /api/:type/:id -> save edits (the whole form)
    if (method === "PUT") {
      const fields = parseFields(RESOURCES[name], await readJson(request));
      checkEdit(name, id, fields);
      const row = await db.updateRow(env.DB, name, user.id, id, fields);
      return row ? json(row) : notFound();
    }

    // DELETE /api/people/:id, /api/locations/:id   -> delete for good
    // DELETE /api/plans/:id?linked_ties=remove|keep -> delete for good; the UI
    //   must ask what to do with linked ties, so there's no default
    if (method === "DELETE") {
      let deleted;
      if (name === "plans") {
        const linkedTies = url.searchParams.get("linked_ties");
        if (linkedTies !== "remove" && linkedTies !== "keep") {
          throw new BadInput("Say what to do with linked ties: linked_ties=remove or linked_ties=keep.");
        }
        deleted = await db.deletePlan(env.DB, user.id, id, linkedTies);
      } else {
        deleted = await db.deleteRow(env.DB, name, user.id, id);
      }
      return deleted ? noContent() : notFound();
    }
  }

  return null;
}
