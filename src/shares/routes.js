// Routes for shares: sealed copies of a profile, tie, plan or workshop that
// someone else opens with a link. The browser seals each one with a key
// that's only in the link; we keep the sealed bytes, hand them to whoever
// opens it while it lasts, and can't read them.

import { BadInput, json, notFound, noContent, readJson } from "../http.js";
import {
  parseNewShare, parseShareId, shareProblem, toBase64url, parseShareFile, shareFileProblem, parseFileRequest,
} from "./parse.js";
import {
  shareCheck, insertShare, listShares, deleteShare, takeShare, deleteUsedUp, endUsedUp, unfinishedShare, addFileBytes,
  markReady, shareWithFiles,
} from "./db.js";
import {
  putSnapshot, getSnapshot, deleteShareFiles, putFile, listFiles, getFilePart, deleteFile,
} from "./storage.js";
import { sha256Hex } from "../auth/session.js";
import { newOfferToken } from "../connections/parse.js";
import { connectionWith, insertOffer } from "../connections/db.js";

/** @typedef {import("../auth/user.js").User} User */

const ONE_PATH = /^\/api\/shares\/([^/]+)$/;
const FILE_PATH = /^\/api\/shares\/([^/]+)\/files\/([^/]+)$/;
const READY_PATH = /^\/api\/shares\/([^/]+)\/ready$/;

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
    // GET /api/shares -> [{ id, kind, label, link_key, bytes, expires_at,
    //   max_uses, use_count, connect, files, created_at }]: my live shares,
    //   newest first (labels and link keys sealed with my data key)
    if (method === "GET") return json(await listShares(db, user.id));

    // POST /api/shares  body { id, kind, label, link_key, expires, max_uses,
    //   snapshot, connect, files } -> { id } (201): a new share. The browser
    //   chose the id, sealed the snapshot (base64url) with the link's key,
    //   and sealed the label and that key with my data key, so I can show
    //   the code again. expires: 10m, 1h, 1d, 7d, 30d or never (until
    //   revoked); max_uses: 1 to 100, or null for any number; connect: a
    //   profile invite offering to connect our accounts; files: how many
    //   photos and videos are to be uploaded with it (PUT
    //   /api/shares/:id/files/:fileId), after which POST
    //   /api/shares/:id/ready makes it openable. At most 50 an account
    //   (live or being uploaded), counted in its 1 GB.
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

  // POST /api/shares/open  body { id } -> { kind, created_at, own, snapshot,
  //   connection_id, offer }: a live share's sealed snapshot (base64url),
  //   for the browser to open with the link's key. Opening someone else's
  //   counts a use, and the last allowed use deletes the share; opening my
  //   own doesn't count. connection_id: my row of our connection, if its
  //   owner and I are connected already. offer: when they aren't and it's
  //   an invite offering to connect, a token for POST /api/connections
  //   (lasting a day; only its hash is kept, not who opened it). 404 for
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
    // Used up: deleted now, unless it has photos still to fetch, when it
    // ends now and the daily clean-up deletes it an hour later.
    if (share.used_up && share.files > 0) {
      await endUsedUp(db, id);
    } else if (share.used_up) {
      await deleteUsedUp(db, id);
      await deleteShareFiles(env.PHOTOS, [{ owner_id: share.owner_id, id }]);
    }
    if (!snapshot) return json({ error: ENDED }, 404);
    const connectionId = share.own ? null : await connectionWith(db, user.id, share.owner_id);
    /** @type {string | null} */
    let offer = null;
    if (share.connect && !share.own && !connectionId) {
      offer = newOfferToken();
      await insertOffer(db, await sha256Hex(offer), share.owner_id, share.label);
    }
    return json({
      kind: share.kind, created_at: share.created_at, own: share.own, snapshot: toBase64url(snapshot),
      connection_id: connectionId, offer,
    });
  }

  // POST /api/shares/files  body { id, file, part } -> one of a share's
  //   photos' or videos' sealed thumbnail or full size (part: thumb or
  //   full), for the browser to open with the link's key. While the share
  //   can be opened, and for an hour after it ends (used up or expired), so
  //   whoever opened it can still add its photos; not after it's revoked.
  //   The file's id is only in the sealed snapshot. 404 for anything else.
  if (url.pathname === "/api/shares/files") {
    if (method !== "POST") return null;
    const asked = parseFileRequest(await readJson(request));
    const share = await shareWithFiles(db, asked.id);
    const part = share && await getFilePart(env.PHOTOS, share.owner_id, asked.id, asked.file, asked.part);
    if (!part) return json({ error: ENDED }, 404);
    return new Response(part.body, {
      headers: { "content-type": "application/octet-stream", "content-length": String(part.length) },
    });
  }

  // PUT /api/shares/:id/files/:fileId?kind=photo|video&thumb_bytes=…
  //   body: the sealed thumbnail then the sealed full size -> { id } (201):
  //   one of the photos or videos of a share of mine still being uploaded
  //   (as many as it said it has, at most 5 of them videos), counted in my
  //   1 GB. The browser chose the file's id.
  const file = url.pathname.match(FILE_PATH);
  if (file) {
    if (method !== "PUT") return null;
    const id = parseShareId(file[1]);
    const upload = parseShareFile(file[2], url.searchParams, request.headers.get("content-length"));
    if (!request.body) throw new BadInput(`Couldn't upload: the ${upload.kind} was empty.`);
    const share = await unfinishedShare(db, user.id, id);
    if (!share) return notFound();
    const stored = await listFiles(env.PHOTOS, user.id, id);
    if (stored.some((f) => f.id === upload.id)) return json({ error: `That ${upload.kind} is already saved.` }, 409);
    const problem = shareFileProblem(
      { files: share.files, stored: stored.length, videos: stored.filter((f) => f.kind === "video").length }, upload.kind)
      // Only the 1 GB: this share is already counted in the 50.
      ?? shareProblem({ ...(await shareCheck(db, user.id, id)), live: 0 }, upload.bytes);
    if (problem) throw new BadInput(problem);
    try {
      await putFile(env.PHOTOS, user.id, id, upload, request.body);
    } catch {
      throw new BadInput(`Couldn't upload: the ${upload.kind} didn't arrive whole. Try again.`);
    }
    // As with photos: if the row can't count it, delete the file again.
    let counted;
    try {
      counted = await addFileBytes(db, user.id, id, upload.bytes);
    } catch (err) {
      await deleteFile(env.PHOTOS, user.id, id, upload.id);
      throw err;
    }
    if (!counted) {
      await deleteFile(env.PHOTOS, user.id, id, upload.id);
      throw new BadInput("Your photos, videos and shares have filled your 1 GB. Delete some to make room.");
    }
    return json({ id: upload.id }, 201);
  }

  // POST /api/shares/:id/ready -> makes a share of mine whose photos and
  //   videos have all been uploaded openable; its expiry counts from now.
  const ready = url.pathname.match(READY_PATH);
  if (ready) {
    if (method !== "POST") return null;
    const id = parseShareId(ready[1]);
    const share = await unfinishedShare(db, user.id, id);
    if (!share) return notFound();
    if ((await listFiles(env.PHOTOS, user.id, id)).length !== share.files) {
      throw new BadInput("Some of its photos didn't arrive. Try sharing it again.");
    }
    if (!(await markReady(db, user.id, id))) return notFound();
    return noContent();
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
