// Routes for photos and videos on ties and plans. The browser strips each
// one's metadata, makes a thumbnail and seals both before uploading; we store the
// sealed object in R2 and its row in D1, and hand it back only to its owner.

import { BadInput, json, notFound, noContent, readJson } from "../http.js";
import { parseItem, parseUpload, parseMediaId, parseCaption, parseOrder, sameIds, limitProblem } from "./parse.js";
import {
  listMedia, uploadCheck, insertMedia, getMediaSizes, setCaption, mediaIds, setOrder, deleteMedia,
} from "./db.js";
import { objectKey, deleteObjects } from "./storage.js";

/** @typedef {import("../auth/user.js").User} User */

const ONE_PATH = /^\/api\/media\/([^/]+)$/;
const PART_PATH = /^\/api\/media\/([^/]+)\/(thumb|full)$/;

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleMedia(request, env, user, url) {
  const db = env.DB;
  const { method } = request;

  // GET /api/media?tie_id=…|plan_id=… -> [{ id, kind, mime, caption,
  //   position, bytes, created_at }]: a tie's or plan's photos, first to
  //   last (captions sealed)
  if (url.pathname === "/api/media") {
    if (method !== "GET") return null;
    const item = parseItem({
      tie_id: url.searchParams.get("tie_id") ?? undefined, plan_id: url.searchParams.get("plan_id") ?? undefined,
    });
    const media = await listMedia(db, user.id, item);
    return media ? json(media) : notFound();
  }

  // PUT /api/media/order  body { tie_id | plan_id, ids } -> puts a tie's or
  //   plan's photos in this order (ids: every one of them, first to last)
  if (url.pathname === "/api/media/order") {
    if (method !== "PUT") return null;
    const body = await readJson(request);
    const item = parseItem(body);
    const ids = parseOrder(body.ids);
    if (!sameIds(ids, await mediaIds(db, user.id, item))) {
      throw new BadInput("The photos have changed. Reload and try again.");
    }
    await setOrder(db, user.id, item, ids);
    return noContent();
  }

  // GET /api/media/:id/thumb|full -> the sealed thumbnail or full size
  const part = url.pathname.match(PART_PATH);
  if (part) {
    if (method !== "GET") return null;
    const id = parseMediaId(part[1]);
    const sizes = await getMediaSizes(db, user.id, id);
    if (!sizes) return notFound();
    const range = part[2] === "thumb"
      ? { offset: 0, length: sizes.thumb_bytes }
      : { offset: sizes.thumb_bytes, length: sizes.bytes - sizes.thumb_bytes };
    const object = await env.PHOTOS.get(objectKey(user.id, id), { range });
    if (!object) return notFound();
    return new Response(object.body, {
      headers: { "content-type": "application/octet-stream", "content-length": String(range.length) },
    });
  }

  const one = url.pathname.match(ONE_PATH);
  if (!one) return null;

  // PUT /api/media/:id?tie_id=…|plan_id=…&kind=photo|video&mime=…&thumb_bytes=…
  //   body: the sealed thumbnail then the sealed full size -> { id,
  //   position } (201): a new photo or video, last on its tie or plan. The
  //   browser chose the id. Up to 30 a tie or plan (5 of them videos) and
  //   1 GB an account.
  if (method === "PUT") {
    const upload = parseUpload(one[1], url.searchParams, request.headers.get("content-length"));
    if (!request.body) throw new BadInput(`Couldn't upload: the ${upload.kind} was empty.`);
    const check = await uploadCheck(db, user.id, upload);
    if (!check.item) return notFound();
    if (check.taken) return json({ error: `That ${upload.kind} is already saved.` }, 409);
    const problem = limitProblem(check, upload);
    if (problem) throw new BadInput(problem);

    // Streamed straight into R2 (no copy held here), checked to be exactly
    // the size the browser said.
    const key = objectKey(user.id, upload.id);
    try {
      await env.PHOTOS.put(key, request.body.pipeThrough(new FixedLengthStream(upload.bytes)), {
        httpMetadata: { contentType: "application/octet-stream" },
      });
    } catch {
      throw new BadInput(`Couldn't upload: the ${upload.kind} didn't arrive whole. Try again.`);
    }
    // The file can't be saved in the same transaction as its row: if the
    // row fails, delete the file again (the daily clean-up catches any
    // left behind).
    let position;
    try {
      position = await insertMedia(db, user.id, upload);
    } catch (err) {
      await env.PHOTOS.delete(key);
      throw err;
    }
    if (position === null) {
      await env.PHOTOS.delete(key);
      throw new BadInput(limitProblem(await uploadCheck(db, user.id, upload), upload) ?? `Couldn't save the ${upload.kind}.`);
    }
    return json({ id: upload.id, position }, 201);
  }

  // PATCH /api/media/:id  body { caption } -> sets or clears the caption
  //   (sealed in the browser)
  if (method === "PATCH") {
    const id = parseMediaId(one[1]);
    const caption = parseCaption((await readJson(request)).caption);
    return (await setCaption(db, user.id, id, caption)) ? noContent() : notFound();
  }

  // DELETE /api/media/:id -> deletes the photo or video and its file
  if (method === "DELETE") {
    const id = parseMediaId(one[1]);
    if (!(await deleteMedia(db, user.id, id))) return notFound();
    await deleteObjects(env.PHOTOS, user.id, [id]);
    return noContent();
  }

  return null;
}
