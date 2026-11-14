// Routes for my identity key (format 2). No route gives anyone else's: a
// public key travels to others inside an invite, sealed with its link's key,
// so the server can't swap in its own.

import { NeedsReauth, json, notFound, readJson } from "../http.js";
import { isFresh } from "../auth/session.js";
import { parseIdentity } from "./parse.js";
import { getIdentity, addIdentity, replaceIdentity } from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleIdentity(request, env, user, url) {
  if (url.pathname !== "/api/identity") return null;
  if (user.format !== 2 && !user.converting) return json({ error: "Reload the app to use this.", reload: true }, 410);
  const { method } = request;

  // GET /api/identity -> { public_key, sealed_seed, created_at }, or 404 if
  //   the account has none yet
  if (method === "GET") {
    const identity = await getIdentity(env.DB, user.id);
    return identity ? json(identity) : notFound();
  }

  // PUT /api/identity  body { public_key, sealed_seed } -> 201 the first
  //   time; replacing it needs a fresh sign-in (contacts would then see a
  //   new key and be warned).
  if (method === "PUT") {
    const identity = parseIdentity(await readJson(request));
    if (await addIdentity(env.DB, user.id, identity)) return json({ ok: true }, 201);
    if (!isFresh(user.session)) throw new NeedsReauth();
    await replaceIdentity(env.DB, user.id, identity);
    return json({ ok: true });
  }

  return null;
}
