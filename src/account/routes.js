// Routes for the account page: my passkeys, my sessions, my recovery code
// and recovery email; and my settings (role names, light/dark mode).
// Adding a passkey is in auth/routes.js (it's the same flow as signing up).

import { BadInput, NeedsReauth, json, notFound, noContent, readJson } from "../http.js";
import { parsePasskeyName, parseRecoverySecret } from "../auth/parse.js";
import { isFresh, sha256Hex } from "../auth/session.js";
import { clearSessionCookie } from "../auth/cookie.js";
import {
  getAccount, renamePasskey, removePasskey, endSession, endOtherSessions, setRecoveryHash, setRecoveryEmail,
  deleteAccount, getSettings, updateSettings,
} from "./db.js";
import { parseSettings, settingsFor, checkFormat } from "./settings.js";
import { parseRecoveryEmail } from "./parse.js";
import { parseWrap } from "../keys/parse.js";
import { hasKey, recoveryWrapStatements } from "../keys/db.js";
import { deleteAllObjects } from "../media/storage.js";

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

  // GET /api/account -> { session_kind, fresh, has_recovery_code,
  //   has_recovery_email, passkeys, sessions } (the current session is
  //   marked current: true)
  if (url.pathname === "/api/account" && request.method === "GET") {
    return json({
      session_kind: user.session.kind,
      fresh: isFresh(user.session),
      ...(await getAccount(db, user.id, user.session.id)),
    });
  }

  // GET /api/account/settings -> { top_label, bottom_label, theme,
  //   seen_release, hide_welcome }: the words I chose for the top and bottom
  //   roles (null: "top", "bottom"), light or dark mode (null: not chosen
  //   yet), the last release whose notes I saw (null: none yet), and whether
  //   I ticked the welcome's "Don't show this again", and the body new poses
  //   start with (default_shape, null: the in-between body). Read by every
  //   page at start, so it's its own small request.
  //   A format 2 account's role names and default body are in its sealed
  //   settings record, so they're null here, and refused on a PUT.
  if (url.pathname === "/api/account/settings" && request.method === "GET") {
    return json(settingsFor(await getSettings(db, user.id), user.format));
  }

  // PUT /api/account/settings  body { top_label?, bottom_label?, theme?, seen_release?, hide_welcome?, default_shape? }
  //   -> { top_label, bottom_label, theme, seen_release, hide_welcome, default_shape }: changes the ones sent. A role
  //   name that's empty, or the role's own name, goes back to the default.
  if (url.pathname === "/api/account/settings" && request.method === "PUT") {
    const body = await readJson(request);
    checkFormat(body, user.format);
    const current = settingsFor(await getSettings(db, user.id), user.format);
    const change = parseSettings(body, current);
    await updateSettings(db, user.id, change);
    return json({ ...current, ...change });
  }

  // DELETE /api/account -> { passkey_ids }: deletes my account and everything
  //   in it, photo files included, for good (needs a recent sign-in), and signs me out. The page
  //   uses passkey_ids to tell the browser those passkeys no longer work.
  if (url.pathname === "/api/account" && request.method === "DELETE") {
    if (!isFresh(user.session)) throw new NeedsReauth();
    const passkeyIds = await deleteAccount(db, user.id);
    await deleteAllObjects(env.PHOTOS, user.id);
    return json({ passkey_ids: passkeyIds }, 200, { "set-cookie": clearSessionCookie() });
  }

  // PUT /api/account/recovery-code  body { recovery_secret, recovery_wrap }
  //   -> replaces my recovery code (needs a recent sign-in). The browser
  //   made the code and sends only the secret derived from it, and, once
  //   the account has an encryption key, the key wrapped for the new code
  //   (saved together, replacing the old code's wrap).
  if (url.pathname === "/api/account/recovery-code" && request.method === "PUT") {
    if (!isFresh(user.session)) throw new NeedsReauth();
    const body = await readJson(request);
    const recoveryHash = await sha256Hex(parseRecoverySecret(body.recovery_secret));
    if (await hasKey(db, user.id)) {
      await db.batch(recoveryWrapStatements(db, user.id, recoveryHash, parseWrap(body.recovery_wrap, "recovery")));
    } else {
      await setRecoveryHash(db, user.id, recoveryHash);
    }
    return noContent();
  }

  // PUT /api/account/recovery-email  body { email_hash, salt } -> sets or
  //   replaces my recovery email (needs a recent sign-in, so a stolen session
  //   can't make itself the way to recover the account). The browser sends
  //   only a hash of the address and its salt, never the address.
  if (url.pathname === "/api/account/recovery-email" && request.method === "PUT") {
    if (!isFresh(user.session)) throw new NeedsReauth();
    await setRecoveryEmail(db, user.id, parseRecoveryEmail(await readJson(request)));
    return noContent();
  }

  // DELETE /api/account/recovery-email -> removes it (needs a recent sign-in)
  if (url.pathname === "/api/account/recovery-email" && request.method === "DELETE") {
    if (!isFresh(user.session)) throw new NeedsReauth();
    await setRecoveryEmail(db, user.id, null);
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
