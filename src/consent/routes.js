// Agreeing to the current privacy policy (see consent/parse.js).

import { BadInput, json, noContent, readJson } from "../http.js";
import { NOW } from "../sql.js";
import { POLICY_VERSION, CONSENT_VERSION, CONSENT_SUMMARY } from "../policy-version.js";
import { needsConsent } from "./parse.js";

/** @typedef {import("../auth/user.js").User} User */

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleConsent(request, env, user, url) {
  if (url.pathname !== "/api/consent") return null;

  // GET /api/consent -> { needed, version, summary }: whether I must agree
  //   to the current policy (version) before going on, and what changed.
  if (request.method === "GET") {
    const needed = needsConsent(user.termsVersion, CONSENT_VERSION);
    return json({ needed, version: POLICY_VERSION, summary: needed ? CONSENT_SUMMARY : null });
  }

  // POST /api/consent  body { version, agree: true } -> 204: I agree to
  //   this version of the policy (the one I was shown, which must still be
  //   the current one).
  if (request.method === "POST") {
    const body = await readJson(request);
    if (body.agree !== true) throw new BadInput("Tick the box to agree to the privacy policy.");
    if (body.version !== POLICY_VERSION) {
      throw new BadInput("The privacy policy has just changed again. Reload the page to see the new one.");
    }
    await env.DB.prepare(`UPDATE users SET accepted_at = ${NOW}, terms_version = ? WHERE id = ?`)
      .bind(POLICY_VERSION, user.id).run();
    return noContent();
  }
  return null;
}
