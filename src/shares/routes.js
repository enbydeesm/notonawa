// Routes for shares: sealed copies of a profile, tie, plan or workshop that
// someone else opens with a link. The browser seals each one with a key
// that's only in the link; we keep the sealed bytes, hand them to whoever
// opens it while it lasts, and can't read them.

import { BadInput, json, notFound, noContent, readJson } from "../http.js";
import { parseNewShare, parseShareId, shareProblem, toBase64url } from "./parse.js";
import { shareCheck, insertShare, listShares, deleteShare, takeShare, deleteUsedUp } from "./db.js";
import { putSnapshot, getSnapshot, deleteShareFiles } from "./storage.js";

/** @typedef {import("../auth/user.js").User} User */

const ONE_PATH = /^\/api\/shares\/([^/]+)$/;

// The same answer however a share has ended (expired, used up, revoked) or
// if it never was, so ids can't be probed.
const ENDED = "This share has ended or doesn't exist.";

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleShares(request, env, user, url) {
  const db = env.DB;
  const { method } = request;

  if (url.pathname === "/api/shares") {
    // GET /api/shares -> [{ id, kind, label, bytes, expires_at, max_uses,
    //   use_count, created_at }]: my live shares, newest first (labels sealed)
    if (method === "GET") return json(await listShares(db, user.id));

    // POST /api/shares  body { id, kind, label, expires, max_uses, snapshot }
    //   -> { id } (201): a new share. The browser chose the id and sealed
    //   the snapshot (base64url) and label. expires: 10m, 1h, 1d, 7d, 30d or
    //   never (until revoked); max_uses: 1 to 100, or null for any number.
    //   At most 50 live an account, counted in its 1 GB.
    if (method === "POST") {
      const share = parseNewShare(await readJson(request));
      const check = await shareCheck(db, user.id, share.id);
      if (check.taken) return json({ error: "That share is already saved." }, 409);
      const problem = shareProblem(check, share.snapshot.length);
      if (problem) throw new BadInput(problem);
      await putSnapshot(env.PHOTOS, user.id, share.id, share.snapshot);
      // The file can't be saved in the same transaction as its row: if the
      // row fails, delete the file again (the daily sweep catches any left).
      const gone = [{ owner_id: user.id, id: share.id }];
      let saved;
      try {
        saved = await insertShare(db, user.id, share, share.snapshot.length);
      } catch (err) {
        await deleteShareFiles(env.PHOTOS, gone);
        throw err;
      }
      if (!saved) {
        await deleteShareFiles(env.PHOTOS, gone);
        throw new BadInput(shareProblem(await shareCheck(db, user.id, share.id), share.snapshot.length) ?? "Couldn't share it.");
      }
      return json({ id: share.id }, 201);
    }
    return null;
  }

  // POST /api/shares/open  body { id } -> { kind, created_at, own, snapshot }:
  //   a live share's sealed snapshot (base64url), for the browser to open
  //   with the link's key. Opening someone else's counts a use, and the last
  //   allowed use deletes the share; opening my own doesn't count. 404 for
  //   any share that's ended or never was. The id is in the body, never the
  //   address. Limited per account (SHARE_RATE_LIMIT).
  if (url.pathname === "/api/shares/open") {
    if (method !== "POST") return null;
    const id = parseShareId((await readJson(request)).id);
    const { success } = await env.SHARE_RATE_LIMIT.limit({ key: user.id });
    if (!success) return json({ error: "Too many shares opened. Wait a minute and try again." }, 429);
    const share = await takeShare(db, user.id, id);
    if (!share) return json({ error: ENDED }, 404);
    const snapshot = await getSnapshot(env.PHOTOS, share.owner_id, id);
    if (share.used_up) {
      await deleteUsedUp(db, id);
      await deleteShareFiles(env.PHOTOS, [{ owner_id: share.owner_id, id }]);
    }
    if (!snapshot) return json({ error: ENDED }, 404);
    return json({ kind: share.kind, created_at: share.created_at, own: share.own, snapshot: toBase64url(snapshot) });
  }

  // DELETE /api/shares/:id -> revokes one of my shares: its row and files
  //   are deleted at once
  const one = url.pathname.match(ONE_PATH);
  if (one && method === "DELETE") {
    const id = parseShareId(one[1]);
    if (!(await deleteShare(db, user.id, id))) return notFound();
    await deleteShareFiles(env.PHOTOS, [{ owner_id: user.id, id }]);
    return noContent();
  }

  return null;
}
