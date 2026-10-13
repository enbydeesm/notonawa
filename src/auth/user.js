// Who's making the request.
//
// We take the email from the verified Access token, so a request that reaches
// the Worker without going through Access can't claim to be anyone. When
// running locally (wrangler dev) there is no Access, so on localhost only we
// fall back to DEV_USER_EMAIL from the .dev.vars file, which only exists on your Mac.

import { verifyAccessJwt, normaliseTeamDomain, createAccessKeyStore } from "./jwt.js";

/** @typedef {{ id: string, email: string }} User */

// One key cache per Worker instance.
const getAccessKey = createAccessKeyStore();

/**
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<User | null>}
 */
export async function getUser(request, env) {
  const email = await signedInEmail(request, env);
  return email ? findOrCreateUser(env.DB, email) : null;
}

/**
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<string | null>}
 */
async function signedInEmail(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (token) {
    const teamDomain = normaliseTeamDomain(env.ACCESS_TEAM_DOMAIN);
    if (!teamDomain || !env.ACCESS_AUD) {
      console.error("ACCESS_TEAM_DOMAIN and ACCESS_AUD must be set to verify Access tokens");
      return null;
    }
    return verifyAccessJwt(token, { teamDomain, aud: env.ACCESS_AUD }, getAccessKey);
  }
  if (isLocalhost(request) && env.DEV_USER_EMAIL) return env.DEV_USER_EMAIL;
  return null;
}

/** @param {Request} request */
function isLocalhost(request) {
  const { hostname } = new URL(request.url);
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * Usually one read. Only the very first request for a new email writes.
 * @param {D1Database} db
 * @param {string} email
 * @returns {Promise<User | null>}
 */
export async function findOrCreateUser(db, email) {
  const user = await db.prepare("SELECT id, email FROM users WHERE email = ?")
    .bind(email)
    .first();
  if (user) return /** @type {User} */ (user);

  // First time we see this email: create the user. If two first requests race,
  // the loser hits the conflict, and the no-op DO UPDATE makes RETURNING give
  // back the row the winner created.
  return db.prepare(
    `INSERT INTO users (id, email) VALUES (?, ?)
     ON CONFLICT(email) DO UPDATE SET email = excluded.email
     RETURNING id, email`
  )
    .bind(crypto.randomUUID(), email)
    .first();
}
