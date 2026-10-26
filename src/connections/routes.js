// Routes for connections between accounts, made when someone accepts a
// profile invite that offers to connect. Pages only ever see their own
// row's id: never the other account's.

import { json, notFound, noContent, readJson } from "../http.js";
import { sha256Hex } from "../auth/session.js";
import { parseAccept, parseConnectionId, parsePersonId, parseAboutChoice } from "./parse.js";
import { listConnections, canLink, acceptOffer, setPerson, markAnswered, removeConnection } from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

const ONE_PATH = /^\/api\/connections\/([^/]+)$/;
const ACTION_PATH = /^\/api\/connections\/([^/]+)\/(person|answered)$/;
const ENDED = "This offer to connect has ended. Ask them for a new invite.";

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleConnections(request, env, user, url) {
  const db = env.DB;
  const { method } = request;
  let m;

  if (url.pathname === "/api/connections") {
    // GET /api/connections -> [{ id, invited, label, answered, created_at,
    //   person_id }]: mine, newest first (labels sealed with my data key;
    //   person_id: which of my people it's on, or null)
    if (method === "GET") return json(await listConnections(db, user.id));

    // POST /api/connections  body { offer, person_id, label } -> { id } (201):
    //   accepts an offer to connect (from POST /api/shares/open), linking it
    //   to one of my people (not me). If we're already connected, that
    //   connection is used. label: my name for it, sealed. 404 once the
    //   offer has ended or been used.
    if (method === "POST") {
      const accept = parseAccept(await readJson(request));
      if (!(await canLink(db, user.id, accept.personId))) return notFound();
      const id = await acceptOffer(db, user.id, { ...accept, tokenHash: await sha256Hex(accept.offer) });
      if (!id) return json({ error: ENDED }, 404);
      return json({ id }, 201);
    }
    return null;
  }

  // PUT /api/connections/:id/person  body { person_id } -> puts it on one of
  //   my people (not me), taking it off any other, and marks it answered
  // POST /api/connections/:id/answered -> marks it answered (Not now, on the
  //   inviter's banner)
  if ((m = url.pathname.match(ACTION_PATH))) {
    const id = parseConnectionId(m[1]);
    if (m[2] === "person" && method === "PUT") {
      const personId = parsePersonId((await readJson(request)).person_id);
      if (!(await canLink(db, user.id, personId))) return notFound();
      return (await setPerson(db, user.id, id, personId)) ? noContent() : notFound();
    }
    if (m[2] === "answered" && method === "POST") {
      return (await markAnswered(db, user.id, id)) ? noContent() : notFound();
    }
    return null;
  }

  // DELETE /api/connections/:id?about=remove|keep -> removes the connection
  //   for both accounts (it comes off both sides' people). about=remove also
  //   clears my About from their card for me. The choice is required.
  if ((m = url.pathname.match(ONE_PATH)) && method === "DELETE") {
    const id = parseConnectionId(m[1]);
    const removeAbout = parseAboutChoice(url.searchParams.get("about"));
    return (await removeConnection(db, user.id, id, removeAbout)) ? noContent() : notFound();
  }

  return null;
}
