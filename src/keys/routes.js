// Routes for wrapped encryption keys: what the browser needs to unlock, the
// first key, and a passkey's wrap. We never see the key, only wraps of it.
// A new account's first wraps come with sign-up, a new passkey's with adding
// it, and a new recovery wrap with a new recovery code (auth/ and account/).

import { BadInput, NeedsReauth, json, notFound, noContent, readJson } from "../http.js";
import { parseRecoverySecret } from "../auth/parse.js";
import { isFresh, sha256Hex } from "../auth/session.js";
import { parseWrap, parseOptionalWrap } from "./parse.js";
import {
  getWraps, hasKey, recoveryWrapStatements, passkeyWrapStatements, deleteWrapsStatement, insertWrapStatement,
} from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

const PASSKEY_WRAP_PATH = /^\/api\/keys\/passkeys\/([^/]+)$/;

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleKeys(request, env, user, url) {
  const db = env.DB;

  // GET /api/keys -> { user_id, has_key, recovery, passkey_id, passkey }:
  //   the wraps the browser needs to unlock. recovery is the recovery wrap
  //   (with current: false if the recovery code was replaced without it,
  //   by the operator); passkey is the wrap for the passkey this session
  //   signed in with, if it has one. Also allowed in a recovery session.
  if (url.pathname === "/api/keys" && request.method === "GET") {
    const passkeyId = user.session.passkey_id;
    const { recovery, passkey } = await getWraps(db, user.id, passkeyId);
    return json({ user_id: user.id, has_key: recovery !== null, recovery, passkey_id: passkeyId, passkey });
  }

  // POST /api/keys/setup  body { recovery_secret, recovery_wrap,
  //   passkey_wrap?, replace? } -> the account's first key (needs a recent
  //   sign-in): a new recovery code with the key wrapped for it, and for
  //   the passkey this session signed in with if it gave PRF output.
  //   replace: true starts a new key instead, deleting every old wrap (for
  //   an account whose key can't be unlocked any more). 409 if the account
  //   already has a key and replace isn't set.
  if (url.pathname === "/api/keys/setup" && request.method === "POST") {
    if (!isFresh(user.session)) throw new NeedsReauth();
    const body = await readJson(request);
    const recoveryHash = await sha256Hex(parseRecoverySecret(body.recovery_secret));
    const recoveryWrap = parseWrap(body.recovery_wrap, "recovery");
    const passkeyWrap = parseOptionalWrap(body.passkey_wrap, "passkey");
    const replace = body.replace === true;
    const passkeyId = user.session.passkey_id;
    if (passkeyWrap && !passkeyId) throw new BadInput("Sign in with a passkey first.");
    if (!replace && (await hasKey(db, user.id))) return json({ error: "Your journal already has an encryption key." }, 409);
    await db.batch([
      ...(replace ? [deleteWrapsStatement(db, user.id)] : []),
      ...recoveryWrapStatements(db, user.id, recoveryHash, recoveryWrap),
      ...(passkeyWrap && passkeyId
        ? [insertWrapStatement(db, user.id, passkeyWrap, { kind: "passkey", passkeyId, recoveryHash: null })]
        : []),
    ]);
    return noContent();
  }

  // PUT /api/keys/passkeys/:id  body { wrap } -> sets the key wrapped for
  //   one of my passkeys, replacing any it had (needs a recent sign-in).
  const passkey = url.pathname.match(PASSKEY_WRAP_PATH);
  if (passkey && request.method === "PUT") {
    if (!isFresh(user.session)) throw new NeedsReauth();
    const wrap = parseWrap((await readJson(request)).wrap, "passkey");
    const mine = await db.prepare("SELECT 1 FROM passkeys WHERE id = ? AND user_id = ?").bind(passkey[1], user.id).first();
    if (!mine) return notFound();
    await db.batch(passkeyWrapStatements(db, user.id, passkey[1], wrap));
    return noContent();
  }

  return null;
}
