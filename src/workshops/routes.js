// Routes for workshops (the Education view).

import { json, notFound, noContent, readJson } from "../http.js";
import { parseWorkshopInput, parseWorkshopUpdate } from "./parse.js";
import { listWorkshops, getWorkshop, insertWorkshop, updateWorkshop, deleteWorkshop } from "./db.js";
import { deleteObjects } from "../media/storage.js";

const ONE_PATH = /^\/api\/workshops\/([^/]+)$/;

/** @typedef {import("../auth/user.js").User} User */

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleWorkshops(request, env, user, url) {
  const one = url.pathname.match(ONE_PATH);
  if (one) {
    const id = one[1];
    // GET /api/workshops/:id -> one of my workshops, as in the list
    if (request.method === "GET") {
      const workshop = await getWorkshop(env.DB, user.id, id);
      return workshop ? json(workshop) : notFound();
    }
    // PUT /api/workshops/:id -> save the whole edit form (as POST, plus
    //   keep_deleted: the deleted people and location to keep)
    if (request.method === "PUT") {
      const workshop = parseWorkshopUpdate(await readJson(request));
      return (await updateWorkshop(env.DB, user.id, id, workshop)) ? json({ id }) : notFound();
    }
    // DELETE /api/workshops/:id -> delete it for good, with its photos (its
    //   people, location and tags stay)
    if (request.method === "DELETE") {
      const photoIds = await deleteWorkshop(env.DB, user.id, id);
      if (!photoIds) return notFound();
      await deleteObjects(env.PHOTOS, user.id, photoIds);
      return noContent();
    }
    return null;
  }

  if (url.pathname !== "/api/workshops") return null;

  // GET /api/workshops -> all my workshops, newest first, with location,
  //   educators, participants and tags (the page searches them itself)
  if (request.method === "GET") return json(await listWorkshops(env.DB, user.id));

  // POST /api/workshops -> add a workshop with its location, educators,
  //   participants and tags (by name; new ones are created)
  if (request.method === "POST") {
    const workshop = parseWorkshopInput(await readJson(request));
    return json({ id: await insertWorkshop(env.DB, user.id, workshop) }, 201);
  }

  return null;
}
