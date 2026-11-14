// Routes for converting an account from format 1 to format 2. The device
// does the conversion (it's the only one that can open the journal); these
// mark when it starts and, once the device has written and checked every
// record and file, finish it. See considerations.md, "Encrypt everything:
// server v2 as built".

import { json } from "../http.js";
import { startConversion, finishConversion, NotConverting } from "./db.js";
import { deleteObjects } from "../media/storage.js";

/** @typedef {import("../auth/user.js").User} User */

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleConvert(request, env, user, url) {
  if (request.method !== "POST") return null;

  // POST /api/convert/start -> { converting_since }: marks my format 1
  //   account as converting. The format 2 routes accept it from now on, and
  //   the format 1 journal can no longer be changed (src/format.js). Starting
  //   again (a conversion resumed) keeps the first time. 409 if it's format 2.
  if (url.pathname === "/api/convert/start") {
    const since = await startConversion(env.DB, user.id);
    if (!since) return json({ error: "Your journal is already updated. Reload the app.", reload: true }, 409);
    return json({ converting_since: since });
  }

  // POST /api/convert/finish -> { ok: true }: in one batch, my account
  //   becomes format 2 and its format 1 journal is deleted; then the old
  //   photos' and videos' files. 409 unless it's converting and has records.
  if (url.pathname === "/api/convert/finish") {
    try {
      const mediaIds = await finishConversion(env.DB, user.id);
      // The rows are gone with the batch; their files after it (the daily
      // sweep catches any this misses).
      if (mediaIds.length) await deleteObjects(env.PHOTOS, user.id, mediaIds);
      return json({ ok: true });
    } catch (err) {
      if (err instanceof NotConverting) return json({ error: "Your journal isn't being updated. Reload the app.", reload: true }, 409);
      throw err;
    }
  }

  return null;
}
