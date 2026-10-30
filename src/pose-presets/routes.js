// Routes for saved poser presets: body and arms positions someone saved,
// theirs to use in any pose. The name is sealed in the browser; the
// angles are plain JSON (parse.js checks them).

import { BadInput, json, notFound, noContent, readJson } from "../http.js";
import { parseNewPreset, parsePresetId, parseName, parsePresetData, MAX_PRESETS } from "./parse.js";
import { listPresets, insertPreset, presetKind, updatePreset, deletePreset } from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

const ONE_PATH = /^\/api\/pose-presets\/([^/]+)$/;

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handlePosePresets(request, env, user, url) {
  const db = env.DB;
  const { method } = request;

  if (url.pathname === "/api/pose-presets") {
    // GET /api/pose-presets -> [{ id, kind, name, data, created_at,
    //   updated_at }]: all of mine, oldest first (names sealed)
    if (method === "GET") return json(await listPresets(db, user.id));
    // POST /api/pose-presets  body { kind: "body" | "arms", name, data }
    //   -> { id } (201): a new preset. Up to 50 an account.
    if (method === "POST") {
      const preset = parseNewPreset(await readJson(request));
      const id = crypto.randomUUID();
      if (!(await insertPreset(db, user.id, { id, ...preset }))) {
        throw new BadInput(`You can keep up to ${MAX_PRESETS} presets. Delete one to save another.`);
      }
      return json({ id }, 201);
    }
    return null;
  }

  const one = url.pathname.match(ONE_PATH);
  if (!one) return null;

  // PUT /api/pose-presets/:id  body { name?, data? } -> renames it (the
  //   name sealed in the browser) and/or saves new angles over its own
  //   (checked as its kind's, which doesn't change); one of them is needed
  if (method === "PUT") {
    const id = parsePresetId(one[1]);
    const body = await readJson(request);
    if (body.name === undefined && body.data === undefined) throw new BadInput("Nothing to change.");
    const name = body.name === undefined ? null : parseName(body.name);
    /** @type {import("./parse.js").PresetData | null} */
    let data = null;
    if (body.data !== undefined) {
      const kind = await presetKind(db, user.id, id);
      if (!kind) return notFound();
      data = parsePresetData(kind, body.data);
    }
    return (await updatePreset(db, user.id, id, { name, data })) ? noContent() : notFound();
  }

  // DELETE /api/pose-presets/:id -> deletes it
  if (method === "DELETE") {
    const id = parsePresetId(one[1]);
    return (await deletePreset(db, user.id, id)) ? noContent() : notFound();
  }

  return null;
}
