// Routes for the account page: my passkeys, my sessions, my recovery code.
// Adding a passkey is in auth/routes.js (it's the same flow as signing up).

import { BadInput, NeedsReauth, json, notFound, noContent, readJson } from "../http.js";
import { parsePasskeyName, parseRecoverySecret } from "../auth/parse.js";
import { isFresh, sha256Hex } from "../auth/session.js";
import { getAccount, renamePasskey, removePasskey, endSession, endOtherSessions, setRecoveryHash } from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

const PASSKEY_PATH = /^\/api\/account\/passkeys\/([^/]+)$/;
const SESSION_PATH = /^\/api\/account\/sessions\/([^/]+)$/;

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleAccount(request, env, user, url) {
  const db = env.DB;

  // GET /api/account -> { session_kind, fresh, has_recovery_code, passkeys,
  //   sessions } (the current session is marked current: true)
  if (url.pathname === "/api/account" && request.method === "GET") {
    return json({
      session_kind: user.session.kind,
      fresh: isFresh(user.session),
      ...(await getAccount(db, user.id, user.session.id)),
    });
  }

  // PUT /api/account/recovery-code  body { recovery_secret } -> replaces my
  //   recovery code (needs a recent sign-in). The browser made the code and
  //   sends only the secret derived from it.
  if (url.pathname === "/api/account/recovery-code" && request.method === "PUT") {
    if (!isFresh(user.session)) throw new NeedsReauth();
    const secret = parseRecoverySecret((await readJson(request)).recovery_secret);
    await setRecoveryHash(db, user.id, await sha256Hex(secret));
    return noContent();
  }

  // POST /api/account/sessions/end-others -> signs out everywhere else
  if (url.pathname === "/api/account/sessions/end-others" && request.method === "POST") {
    await endOtherSessions(db, user.id, user.session.id);
    return noContent();
  }

  // DELETE /api/account/sessions/:id -> ends one of my sessions
  const session = url.pathname.match(SESSION_PATH);
  if (session && request.method === "DELETE") {
    return (await endSession(db, user.id, session[1])) ? noContent() : notFound();
  }

  const passkey = url.pathname.match(PASSKEY_PATH);
  // PATCH /api/account/passkeys/:id  body { name } -> renames one of my passkeys
  if (passkey && request.method === "PATCH") {
    const name = parsePasskeyName((await readJson(request)).name);
    return (await renamePasskey(db, user.id, passkey[1], name)) ? noContent() : notFound();
  }
  // DELETE /api/account/passkeys/:id -> removes one (needs a recent sign-in;
  //   never my last one). Sessions it started end too.
  if (passkey && request.method === "DELETE") {
    if (!isFresh(user.session)) throw new NeedsReauth();
    const result = await removePasskey(db, user.id, passkey[1]);
    if (result === "last") throw new BadInput("You can't remove your only passkey. Add another one first.");
    return result === "removed" ? noContent() : notFound();
  }

  return null;
}
