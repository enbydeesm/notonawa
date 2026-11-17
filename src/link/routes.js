// Signing in on a new device with one that's signed in, as Signal links a
// device (migration 0034; see considerations.md, "Linking a device as
// built"). The new device makes a request with a throwaway public key and
// shows it as a QR code; the signed-in device scans it, checks the key
// against the code, and approves with the data key sealed to it; the new
// device picks that up with a session that can only add a passkey (a
// recovery-kind session, src/auth/guard.js), and adds one.
//
// index.js rate-limits every /api/link route per IP (LINK_RATE_LIMIT).

import { NeedsReauth, json, notFound, readJson } from "../http.js";
import { sessionCookie } from "../auth/cookie.js";
import { newSessionStatements, deleteSessionStatement } from "../auth/db.js";
import { isFresh, lifetimeMs, newToken, sha256Hex } from "../auth/session.js";
import { getUser } from "../auth/user.js";
import { ENDED, linkId, parseApproval, parseNewLink, parsePoll } from "./parse.js";
import { approveLink, declineLink, insertLink, linkForPoll, takeLink, waitingLink } from "./db.js";

/** @param {string} pathname */
export const isLinkRoute = (pathname) => /^\/api\/link(\/|$)/.test(pathname);

/**
 * The new device's routes, signed out. Returns null for any other request.
 * @param {Request} request
 * @param {Env} env
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleLinkSignedOut(request, env, url) {
  if (request.method !== "POST") return null;
  const db = env.DB;

  // POST /api/link  body { public_key } -> { id, poll, expires_at }: a new
  //   request, for 5 minutes. poll is the token to ask about it with (only
  //   its hash is kept).
  if (url.pathname === "/api/link") {
    const publicKey = parseNewLink(await readJson(request));
    const id = crypto.randomUUID();
    const poll = newToken();
    const expiresAt = await insertLink(db, { id, pollHash: await sha256Hex(poll), publicKey });
    return json({ id, poll, expires_at: expiresAt }, 201);
  }

  // POST /api/link/status  body { id, poll } -> { state: "waiting" }, or
  //   once approved { state: "approved", user_id, sealed_key } and a
  //   15-minute session that can only add a passkey. The request is
  //   deleted then, so it's picked up once. Ended, declined or unknown: 404.
  if (url.pathname === "/api/link/status") {
    const { id, poll } = parsePoll(await readJson(request));
    const pollHash = await sha256Hex(poll);
    const link = await linkForPoll(db, id, pollHash);
    if (!link) return json({ error: ENDED }, 404);
    if (!link.user_id || !link.sealed_key) return json({ state: "waiting" });
    if (!(await takeLink(db, id, pollHash))) return json({ error: ENDED }, 404);

    // Signed in already on this device (say, part-way through a recovery
    // that was given up): that session ends, as signing in again does.
    const current = await getUser(request, env);
    const { token, statements } = await newSessionStatements(db, link.user_id, { kind: "recovery", passkeyId: null });
    await db.batch([...(current ? [deleteSessionStatement(db, current.session.id)] : []), ...statements]);
    return json(
      { state: "approved", user_id: link.user_id, sealed_key: link.sealed_key },
      200,
      { "set-cookie": sessionCookie(token, lifetimeMs("recovery") / 1000) },
    );
  }

  return null;
}

/**
 * The approving device's routes, signed in with a full session (index.js
 * refuses a recovery one). Returns null for any other request.
 * @param {Request} request
 * @param {Env} env
 * @param {import("../auth/user.js").User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleLink(request, env, user, url) {
  const match = url.pathname.match(/^\/api\/link\/([^/]+)(\/approve)?$/);
  if (!match) return null;
  const id = linkId(match[1]);
  if (!id) return notFound();
  const db = env.DB;

  // GET /api/link/:id -> { public_key, expires_at }: a request waiting to
  //   be approved (not one that's approved, ended or unknown: 404).
  if (request.method === "GET" && !match[2]) {
    const link = await waitingLink(db, id);
    return link ? json(link) : json({ error: ENDED }, 404);
  }

  // POST /api/link/:id/approve  body { sealed_key } -> approves it for my
  //   account. Needs a recent sign-in: the page asks for the passkey first,
  //   to wrap the key. Already approved, ended or unknown: 404.
  if (request.method === "POST" && match[2]) {
    if (!isFresh(user.session)) throw new NeedsReauth();
    const sealedKey = parseApproval(await readJson(request));
    if (!(await approveLink(db, id, user.id, sealedKey))) return json({ error: ENDED }, 404);
    return json({ ok: true });
  }

  // DELETE /api/link/:id -> declines it: one waiting, or one I approved
  //   that hasn't been picked up.
  if (request.method === "DELETE" && !match[2]) {
    await declineLink(db, id, user.id);
    return json({ ok: true });
  }

  return notFound();
}
