// Routes for poses on ties, plans and workshops. A pose is its figure's
// joint angles, view and ropes, as plain JSON (parse.js checks them); its
// caption is sealed in the browser. Duplicating one, or copying it to
// another item, is adding a new pose with the same data: the page has it
// already.

import { BadInput, json, notFound, noContent, readJson } from "../http.js";
import { parseItem, itemFromParams } from "../media/parse.js";
import { parsePose, parsePoseId, parseCaption, parseEdit, MAX_PER_ITEM, MAX_BODY_BYTES } from "./parse.js";
import { listPoses, insertPose, updatePose, deletePose } from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

const ONE_PATH = /^\/api\/poses\/([^/]+)$/;

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handlePoses(request, env, user, url) {
  const db = env.DB;
  const { method } = request;

  if (url.pathname === "/api/poses") {
    // GET /api/poses?tie_id=…|plan_id=…|workshop_id=… -> [{ id, data,
    //   caption, position, created_at, updated_at }]: an item's poses,
    //   first to last (captions sealed)
    if (method === "GET") {
      const poses = await listPoses(db, user.id, itemFromParams(url.searchParams));
      return poses ? json(poses) : notFound();
    }
    // POST /api/poses  body { tie_id | plan_id | workshop_id, data,
    //   caption } -> { id, position } (201): a new pose, last on its
    //   item. Up to 20 an item.
    if (method === "POST") {
      const body = await readPoseBody(request);
      const item = parseItem(body);
      const data = parsePose(body.data);
      const caption = parseCaption(body.caption);
      const id = crypto.randomUUID();
      const result = await insertPose(db, user.id, { id, item, data, caption });
      if ("problem" in result) {
        if (result.problem === "missing") return notFound();
        throw new BadInput(`There can be at most ${MAX_PER_ITEM} poses on a tie, plan or workshop.`);
      }
      return json({ id, position: result.position }, 201);
    }
    return null;
  }

  const one = url.pathname.match(ONE_PATH);
  if (!one) return null;

  // PUT /api/poses/:id  body { data?, caption? } -> saves a new pose, a new
  //   caption (sealed in the browser), or both
  if (method === "PUT") {
    const id = parsePoseId(one[1]);
    const edit = parseEdit(await readPoseBody(request));
    return (await updatePose(db, user.id, id, edit)) ? noContent() : notFound();
  }

  // DELETE /api/poses/:id -> deletes the pose
  if (method === "DELETE") {
    const id = parsePoseId(one[1]);
    return (await deletePose(db, user.id, id)) ? noContent() : notFound();
  }

  return null;
}

/**
 * A request body with a pose in it, refused if it's too big.
 * @param {Request} request
 */
async function readPoseBody(request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new BadInput("That pose is too detailed to store.");
  return readJson(request);
}
