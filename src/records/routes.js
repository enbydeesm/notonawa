// Routes for sealed records (format 2): syncing them down, and writing and
// deleting them in batches. The server stores and returns what it's given;
// it can't read a record.

import { json, readJson } from "../http.js";
import { parseBatch, parseSyncQuery, pageCut, Stale, OverQuota } from "./parse.js";
import { syncPage, writeRecords } from "./db.js";
import { deleteFileObjects } from "../files/storage.js";

/** @typedef {import("../auth/user.js").User} User */

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleRecords(request, env, user, url) {
  const { method } = request;
  if (url.pathname !== "/api/sync" && url.pathname !== "/api/records") return null;
  // Only an account in format 2, or being converted to it.
  if (user.format !== 2 && !user.converting) return json({ error: "Reload the app to use this.", reload: true }, 410);

  // GET /api/sync?since=<seq>&limit=<n> -> { changes: [{ id, kind, seq,
  //   deleted, version, key, body }], next, done }: my records and deletion
  //   markers with seq above since, oldest first, as many as fit a page (up
  //   to limit, 500 at most, and about 8 MB of bodies). Ask again from next
  //   until done.
  if (url.pathname === "/api/sync" && method === "GET") {
    return json(await syncPage(env.DB, user.id, parseSyncQuery(url), pageCut));
  }

  // POST /api/records  body { writes: [{ id, kind, base_version, key, body }],
  //   deletes: [{ id, kind, base_version, files: [file ids it frees] }] }
  //   -> { saved: [{ id, version, seq }] }: up to 50 at once, all or none.
  //   base_version 0 is a new record (its id unused). 409 { stale: [ids] }
  //   if any wasn't at the version it was based on (another device changed
  //   it first); 413 if the account would be over its 1 GB.
  if (url.pathname === "/api/records" && method === "POST") {
    const ops = parseBatch(await readJson(request));
    try {
      const { saved, freed } = await writeRecords(env.DB, user.id, ops);
      // The rows are gone with the batch; their objects after it.
      if (freed.length) await deleteFileObjects(env.PHOTOS, user.id, freed);
      return json({ saved });
    } catch (err) {
      if (err instanceof Stale) return json({ error: err.message, stale: err.ids }, 409);
      if (err instanceof OverQuota) return json({ error: "Your journal has filled its 1 GB. Delete some photos or videos to make room." }, 413);
      throw err;
    }
  }

  return null;
}
