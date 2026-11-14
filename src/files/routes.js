// Routes for format v3 files: photos and videos sealed on the device, each
// with a key of its own that only its item's record holds. We store the
// sealed object in R2 and its sizes in D1, and hand it back only to its
// owner. Nothing here says which item a file is on.

import { BadInput, json, notFound, readJson } from "../http.js";
import { parseUpload, parseFileId, parseDeleteIds, roomLeft } from "./parse.js";
import { uploadCheck, insertFile, fileSizes, listFiles, deleteFiles } from "./db.js";
import { fileObjectKey, deleteFileObjects } from "./storage.js";

/** @typedef {import("../auth/user.js").User} User */

const ONE_PATH = /^\/api\/files\/([^/]+)$/;
const PART_PATH = /^\/api\/files\/([^/]+)\/(thumb|full)$/;
const FULL = "Your journal has filled its 1 GB. Delete some photos or videos to make room.";

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleFiles(request, env, user, url) {
  if (!url.pathname.startsWith("/api/files")) return null;
  const db = env.DB;
  const { method } = request;
  if (user.format !== 2 && !user.converting) return json({ error: "Reload the app to use this.", reload: true }, 410);

  // GET /api/files -> [{ id, kind, thumb_bytes, bytes, created_at }]: every
  //   file of mine, for the device to find ones no record lists
  if (url.pathname === "/api/files") return method === "GET" ? json(await listFiles(db, user.id)) : null;

  // POST /api/files/delete  body { ids } -> { deleted: [ids] }: deletes
  //   files of mine (up to 1000), rows then objects
  if (url.pathname === "/api/files/delete") {
    if (method !== "POST") return null;
    const deleted = await deleteFiles(db, user.id, parseDeleteIds(await readJson(request)));
    await deleteFileObjects(env.PHOTOS, user.id, deleted);
    return json({ deleted });
  }

  // GET /api/files/:id/thumb|full -> the sealed thumbnail or full size
  const part = url.pathname.match(PART_PATH);
  if (part) {
    if (method !== "GET") return null;
    const id = parseFileId(part[1]);
    const sizes = await fileSizes(db, user.id, id);
    if (!sizes) return notFound();
    const range = part[2] === "thumb"
      ? { offset: 0, length: sizes.thumb_bytes }
      : { offset: sizes.thumb_bytes, length: sizes.bytes - sizes.thumb_bytes };
    const object = await env.PHOTOS.get(fileObjectKey(user.id, id), { range });
    if (!object) return notFound();
    return new Response(object.body, {
      headers: { "content-type": "application/octet-stream", "content-length": String(range.length) },
    });
  }

  // PUT /api/files/:id?kind=photo|video&thumb_bytes=…  body: the sealed
  //   thumbnail then the sealed full size -> { id } (201). The browser
  //   chose the id. Up to 10 MB a photo, 40 MB a video, 1 GB an account
  //   (while converting, its format 1 photos don't count).
  const one = url.pathname.match(ONE_PATH);
  if (!one || method !== "PUT") return null;
  const upload = parseUpload(one[1], url.searchParams, request.headers.get("content-length"));
  if (!request.body) throw new BadInput(`Couldn't upload: the ${upload.kind} was empty.`);
  const check = await uploadCheck(db, user.id, upload.id);
  if (check.taken) return json({ error: `That ${upload.kind} is already saved.` }, 409);
  if (upload.bytes > roomLeft({ ...check, converting: user.converting })) throw new BadInput(FULL);
  // Streamed straight into R2, checked to be exactly the size the browser said.
  const key = fileObjectKey(user.id, upload.id);
  try {
    await env.PHOTOS.put(key, request.body.pipeThrough(new FixedLengthStream(upload.bytes)), {
      httpMetadata: { contentType: "application/octet-stream" },
    });
  } catch {
    throw new BadInput(`Couldn't upload: the ${upload.kind} didn't arrive whole. Try again.`);
  }
  // The object can't be saved in the same transaction as its row: if the
  // row fails, delete the object again (the daily sweep catches any left).
  let added;
  try {
    added = await insertFile(db, user.id, upload, user.converting);
  } catch (err) {
    await env.PHOTOS.delete(key);
    throw err;
  }
  if (!added) {
    await env.PHOTOS.delete(key);
    throw new BadInput(FULL);
  }
  return json({ id: upload.id }, 201);
}
