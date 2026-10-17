// Routes for plans, people and locations: list, add, edit, archive, restore, delete.

import { BadInput, json, notFound, noContent, readJson } from "../http.js";
import { toFlag } from "../parse.js";
import { RESOURCES, RESOURCE_NAMES, parseFields, checkEdit, parseArchivedFilter } from "./config.js";
import * as db from "./db.js";
import { deleteObjects } from "../media/storage.js";

/** @typedef {import("./config.js").ResourceName} ResourceName */
/** @typedef {import("../auth/user.js").User} User */

const NAMES = RESOURCE_NAMES.join("|");
const LIST_PATH = new RegExp(`^/api/(${NAMES})$`);
const ITEM_PATH = new RegExp(`^/api/(${NAMES})/([^/]+)$`);
const ACTION_PATH = new RegExp(`^/api/(${NAMES})/([^/]+)/(archive|restore)$`);
const SELF_KEPT = "Your own profile can't be deleted or archived. You can rename it.";

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

  // GET /api/:type?archived=false|true|all -> active items (pickers, default
  //   lists), archived items only, or both. The parameter is required.
  // POST /api/:type           -> add
  if ((m = url.pathname.match(LIST_PATH))) {
    const name = /** @type {ResourceName} */ (m[1]);

    if (method === "GET") {
      const archived = parseArchivedFilter(url.searchParams.get("archived"));
      return json(await db.listRows(env.DB, name, user.id, archived));
    }

    if (method === "POST") {
      const body = await readJson(request);
      const fields = parseFields(RESOURCES[name], body);
      const archiveNow = !!RESOURCES[name].archiveOnCreate && toFlag(body.archive_now) === 1;
      // An archived location can't be the default.
      if (archiveNow) setValue(fields, "is_default", 0);
      const id = await db.insertRow(env.DB, name, user.id, fields, archiveNow, isNewDefault(name, fields));
      return json({ id }, 201);
    }
  }

  // POST /api/:type/:id/archive -> hide from pickers and default lists (not
  //   my own profile: it has to stay in the tie form's people picker)
  // POST /api/:type/:id/restore -> un-archive
  if ((m = url.pathname.match(ACTION_PATH)) && method === "POST") {
    const name = /** @type {ResourceName} */ (m[1]);
    if (m[3] === "archive" && name === "people" && (await db.isSelf(env.DB, user.id, m[2]))) {
      throw new BadInput(SELF_KEPT);
    }
    const row = m[3] === "archive"
      ? await db.archiveRow(env.DB, name, user.id, m[2])
      : await db.restoreRow(env.DB, name, user.id, m[2]);
    return row ? json(row) : notFound();
  }

  if ((m = url.pathname.match(ITEM_PATH))) {
    const name = /** @type {ResourceName} */ (m[1]);
    const id = m[2];

    // PUT /api/:type/:id -> save edits (the whole form; is_self and a plan's
    //   stage are ignored: who is me can't be changed, and stage is no longer
    //   on the form). A location saved with is_default becomes the default in
    //   place of the old one (the page asks first); an archived one can't be.
    if (method === "PUT") {
      const fields = parseFields(RESOURCES[name], await readJson(request), { editing: true });
      checkEdit(name, id, fields);
      if (isNewDefault(name, fields) && (await db.isArchived(env.DB, name, user.id, id))) {
        throw new BadInput("An archived location can't be the default. Restore it first.");
      }
      const row = await db.updateRow(env.DB, name, user.id, id, fields, isNewDefault(name, fields));
      return row ? json(row) : notFound();
    }

    // DELETE /api/people/:id, /api/locations/:id   -> delete for good (not
    //   my own profile: Calendar, Analytics and the tie form rely on it)
    // DELETE /api/plans/:id?linked_ties=remove|keep -> delete for good, with
    //   its photos; the UI must ask what to do with linked ties, so there's
    //   no default
    if (method === "DELETE") {
      let deleted;
      if (name === "plans") {
        const linkedTies = url.searchParams.get("linked_ties");
        if (linkedTies !== "remove" && linkedTies !== "keep") {
          throw new BadInput("Say what to do with linked ties: linked_ties=remove or linked_ties=keep.");
        }
        const photoIds = await db.deletePlan(env.DB, user.id, id, linkedTies);
        if (photoIds) await deleteObjects(env.PHOTOS, user.id, photoIds);
        deleted = photoIds !== null;
      } else {
        if (name === "people" && (await db.isSelf(env.DB, user.id, id))) throw new BadInput(SELF_KEPT);
        deleted = await db.deleteRow(env.DB, name, user.id, id);
      }
      return deleted ? noContent() : notFound();
    }
  }

  return null;
}

/**
 * Whether the fields make a location the default.
 * @param {ResourceName} name
 * @param {{ columns: string[], values: unknown[] }} fields
 */
function isNewDefault(name, { columns, values }) {
  return name === "locations" && values[columns.indexOf("is_default")] === 1;
}

/**
 * @param {{ columns: string[], values: unknown[] }} fields
 * @param {string} column
 * @param {unknown} value
 */
function setValue({ columns, values }, column, value) {
  const i = columns.indexOf(column);
  if (i >= 0) values[i] = value;
}
