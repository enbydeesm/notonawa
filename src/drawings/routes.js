// Routes for drawings on ties, plans and workshops. A drawing is its lines,
// as plain JSON (parse.js checks them); its caption is sealed in the
// browser. Duplicating one, or copying it to another item, is adding a new
// drawing with the same lines: the page has them already.

import { BadInput, json, notFound, noContent, readJson } from "../http.js";
import { parseItem, itemFromParams } from "../media/parse.js";
import { parseDrawing, parseDrawingId, parseCaption, parseEdit, parseOrder, MAX_PER_ITEM, MAX_BODY_BYTES } from "./parse.js";
import { listDrawings, insertDrawing, updateDrawing, setOrder, deleteDrawing } from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

const ONE_PATH = /^\/api\/drawings\/([^/]+)$/;

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleDrawings(request, env, user, url) {
  const db = env.DB;
  const { method } = request;

  if (url.pathname === "/api/drawings") {
    // GET /api/drawings?tie_id=…|plan_id=…|workshop_id=… -> [{ id, data,
    //   caption, position, created_at, updated_at }]: an item's drawings,
    //   first to last (captions sealed)
    if (method === "GET") {
      const drawings = await listDrawings(db, user.id, itemFromParams(url.searchParams));
      return drawings ? json(drawings) : notFound();
    }
    // POST /api/drawings  body { tie_id | plan_id | workshop_id, data,
    //   caption } -> { id, position } (201): a new drawing, last on its
    //   item. Up to 20 an item.
    if (method === "POST") {
      const body = await readDrawingBody(request);
      const item = parseItem(body);
      const data = parseDrawing(body.data);
      const caption = parseCaption(body.caption);
      const id = crypto.randomUUID();
      const result = await insertDrawing(db, user.id, { id, item, data, caption });
      if ("problem" in result) {
        if (result.problem === "missing") return notFound();
        throw new BadInput(`There can be at most ${MAX_PER_ITEM} drawings on a tie, plan or workshop.`);
      }
      return json({ id, position: result.position }, 201);
    }
    return null;
  }

  // PUT /api/drawings/order  body { tie_id | plan_id | workshop_id, ids } ->
  //   puts an item's drawings in this order (ids: every one of them, first
  //   to last)
  if (url.pathname === "/api/drawings/order") {
    if (method !== "PUT") return null;
    const body = await readJson(request);
    const item = parseItem(body);
    if (!(await setOrder(db, user.id, item, parseOrder(body.ids)))) {
      throw new BadInput("The drawings have changed. Reload and try again.");
    }
    return noContent();
  }

  const one = url.pathname.match(ONE_PATH);
  if (!one) return null;

  // PUT /api/drawings/:id  body { data?, caption? } -> saves new lines, a new
  //   caption (sealed in the browser), or both
  if (method === "PUT") {
    const id = parseDrawingId(one[1]);
    const edit = parseEdit(await readDrawingBody(request));
    return (await updateDrawing(db, user.id, id, edit)) ? noContent() : notFound();
  }

  // DELETE /api/drawings/:id -> deletes the drawing
  if (method === "DELETE") {
    const id = parseDrawingId(one[1]);
    return (await deleteDrawing(db, user.id, id)) ? noContent() : notFound();
  }

  return null;
}

/**
 * A request body with a drawing in it, refused if it's too big.
 * @param {Request} request
 */
async function readDrawingBody(request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new BadInput("That drawing is too detailed to store.");
  return readJson(request);
}
