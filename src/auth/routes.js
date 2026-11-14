// Routes for signing up, signing in (with a passkey or a recovery code) and
// signing out. These work without a session; index.js rate-limits them.

import { BadInput, NeedsReauth, json, readJson } from "../http.js";
import { sessionCookie, clearSessionCookie } from "./cookie.js";
import {
  saveChallenge, takeChallenge, inviteIsUsable, insertPasskeyStatement, newUserStatements,
  passkeyIds, findPasskey, usedPasskeyStatement, newSessionStatements, deleteSessionStatement,
  userWithRecovery,
} from "./db.js";
import {
  parseSignUp, parseRecoverySecret, parsePasskeyName, parsePrfCapable, parseCredential, challengeOf,
} from "./parse.js";
import { isFresh, lifetimeMs, sha256Hex } from "./session.js";
import { getUser } from "./user.js";
import { newAccountFormat } from "../format.js";
import { parseWrap, parseOptionalWrap } from "../keys/parse.js";
import { insertWrapStatement } from "../keys/db.js";
import { registrationOptions, verifyRegistration, authenticationOptions, verifyAuthentication } from "./webauthn.js";

/** @typedef {import("./session.js").SessionKind} SessionKind */

const TOO_SLOW = "That took too long, or was already used. Please try again.";

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleAuth(request, env, url) {
  if (request.method !== "POST") return null;
  const db = env.DB;

  // POST /api/auth/register/options
  //   Signed out: a new account. Body { invite, adult: true, consent: true }.
  //   Signed in: adds a passkey to my account (needs a recent sign-in).
  //   -> options for navigator.credentials.create()
  if (url.pathname === "/api/auth/register/options") {
    const body = await readJson(request);
    const user = await getUser(request, env);
    if (user) {
      if (!isFresh(user.session)) throw new NeedsReauth();
      const options = await registrationOptions(env, user.id, await passkeyIds(db, user.id));
      await saveChallenge(db, { challenge: options.challenge, purpose: "register", user_id: user.id });
      return json(options);
    }
    const inviteHash = await sha256Hex(parseSignUp(body).invite);
    if (!(await inviteIsUsable(db, inviteHash))) {
      throw new BadInput("That invite code doesn't work. It may have been used or expired.");
    }
    const newUserId = crypto.randomUUID();
    const options = await registrationOptions(env, newUserId, []);
    await saveChallenge(db, { challenge: options.challenge, purpose: "register", new_user_id: newUserId, invite_hash: inviteHash });
    return json(options);
  }

  // POST /api/auth/register/verify
  //   body { response, name, prf_capable, passkey_wrap?, and for new accounts
  //   recovery_secret and recovery_wrap }
  //   -> saves the passkey, with the encryption key wrapped for it if it
  //   gave PRF output. A new account is created with its key (wrapped for
  //   its recovery code) and signed in; a recovery session becomes a full one.
  if (url.pathname === "/api/auth/register/verify") {
    const body = await readJson(request);
    const response = parseCredential(body.response);
    const name = parsePasskeyName(body.name);
    const prfCapable = parsePrfCapable(body.prf_capable);
    const passkeyWrap = parseOptionalWrap(body.passkey_wrap, "passkey");
    const challenge = await takeChallenge(db, challengeOf(response), "register");
    if (!challenge) throw new BadInput(TOO_SLOW);
    const credential = await verifyRegistration(env, response, challenge.challenge);
    if (!credential) throw new BadInput("Couldn't verify that passkey. Please try again.");
    const passkey = { ...credential, name, prf_capable: prfCapable };
    /** @param {string} userId */
    const wrapStatements = (userId) => (passkeyWrap
      ? [insertWrapStatement(db, userId, passkeyWrap, { kind: "passkey", passkeyId: passkey.id, recoveryHash: null })]
      : []);

    // Adding a passkey to an existing account: still signed in as them?
    if (challenge.user_id) {
      const user = await getUser(request, env);
      if (!user || user.id !== challenge.user_id) return json({ error: "Not signed in" }, 401);
      const statements = [insertPasskeyStatement(db, user.id, passkey), ...wrapStatements(user.id)];
      if (user.session.kind !== "recovery") {
        await db.batch(statements);
        return json({ ok: true });
      }
      // Recovered: swap the recovery session for a full one with the new passkey.
      const { token, statements: start } = await newSessionStatements(db, user.id, { kind: "full", passkeyId: passkey.id });
      await db.batch([...statements, deleteSessionStatement(db, user.session.id), ...start]);
      return signedIn(token, "full");
    }

    // A new account.
    if (!challenge.new_user_id || !challenge.invite_hash) throw new BadInput(TOO_SLOW);
    const recoveryHash = await sha256Hex(parseRecoverySecret(body.recovery_secret));
    const recoveryWrap = parseWrap(body.recovery_wrap, "recovery");
    const userId = challenge.new_user_id;
    const { token, statements: start } = await newSessionStatements(db, userId, { kind: "full", passkeyId: passkey.id });
    await db.batch([
      ...newUserStatements(db, userId, challenge.invite_hash, recoveryHash, newAccountFormat(env.NEW_ACCOUNT_FORMAT)),
      insertPasskeyStatement(db, userId, passkey),
      insertWrapStatement(db, userId, recoveryWrap, { kind: "recovery", passkeyId: null, recoveryHash }),
      ...wrapStatements(userId),
      ...start,
    ]);
    return signedIn(token, "full");
  }

  // POST /api/auth/login/options -> options for navigator.credentials.get()
  if (url.pathname === "/api/auth/login/options") {
    const options = await authenticationOptions(env);
    await saveChallenge(db, { challenge: options.challenge, purpose: "login" });
    return json(options);
  }

  // POST /api/auth/login/verify  body { response, prf } -> signs in.
  //   Signing in again while signed in (to confirm it's you) replaces the
  //   old session. prf: true if the passkey gave PRF output (never the
  //   output itself), which records that it can unlock.
  if (url.pathname === "/api/auth/login/verify") {
    const body = await readJson(request);
    const response = parseCredential(body.response);
    const challenge = await takeChallenge(db, challengeOf(response), "login");
    if (!challenge) throw new BadInput(TOO_SLOW);
    const passkey = await findPasskey(db, response.id);
    if (!passkey) throw new BadInput("That passkey isn't registered here. It may have been removed.");
    const result = await verifyAuthentication(env, response, challenge.challenge, passkey);
    if (!result) throw new BadInput("Couldn't verify that passkey. Please try again.");

    const current = await getUser(request, env);
    const { token, statements: start } = await newSessionStatements(db, passkey.user_id, { kind: "full", passkeyId: passkey.id });
    await db.batch([
      usedPasskeyStatement(db, passkey.id, result.counter, body.prf === true),
      ...(current ? [deleteSessionStatement(db, current.session.id)] : []),
      ...start,
    ]);
    return signedIn(token, "full");
  }

  // POST /api/auth/recover  body { recovery_secret } -> a 15-minute session
  //   that can only add a passkey (see index.js).
  if (url.pathname === "/api/auth/recover") {
    const secret = parseRecoverySecret((await readJson(request)).recovery_secret);
    const userId = await userWithRecovery(db, await sha256Hex(secret));
    if (!userId) throw new BadInput("That recovery code didn't work.");
    const { token, statements } = await newSessionStatements(db, userId, { kind: "recovery", passkeyId: null });
    await db.batch(statements);
    return signedIn(token, "recovery");
  }

  // POST /api/auth/logout -> ends this session
  if (url.pathname === "/api/auth/logout") {
    const user = await getUser(request, env);
    if (user) await deleteSessionStatement(db, user.session.id).run();
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  return null;
}

/**
 * @param {string} token
 * @param {SessionKind} kind
 */
function signedIn(token, kind) {
  return json({ ok: true, kind }, 200, { "set-cookie": sessionCookie(token, lifetimeMs(kind) / 1000) });
}
