// Who's making the request: the user of the session in the request's cookie.
// The cookie holds a random token; we look up its hash, and end the session
// if it has expired or sat unused too long.

import { readSessionToken } from "./cookie.js";
import { findSession, deleteSessionStatement, touchSession } from "./db.js";
import { isActive, needsTouch, sha256Hex } from "./session.js";

/** @typedef {import("./session.js").Session} Session */
/** @typedef {{ id: string, session: Session }} User */

/**
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<User | null>}
 */
export async function getUser(request, env) {
  const token = readSessionToken(request);
  if (!token) return null;
  const session = await findSession(env.DB, await sha256Hex(token));
  if (!session) return null;

  const now = Date.now();
  if (!isActive(session, now)) {
    await deleteSessionStatement(env.DB, session.id).run();
    return null;
  }
  if (needsTouch(session, now)) await touchSession(env.DB, session.id);
  return { id: session.user_id, session };
}
