// Rope Journal - Worker script
// Sits between your pages (in /public) and the database (env.DB).
// Anything under /api/ is handled here; everything else is served from /public.

import { getUser } from "./auth/user.js";
import { isAllowedOrigin, allowedInRecovery, rateLimitKey } from "./auth/guard.js";
import { json, notFound } from "./http.js";
import { errorResponse } from "./errors.js";
import { withSecurityHeaders } from "./security-headers.js";
import { handleAuth } from "./auth/routes.js";
import { handleAccount } from "./account/routes.js";
import { handleKeys } from "./keys/routes.js";
import { handleEncryption } from "./encryption/routes.js";
import { handleTies } from "./ties/routes.js";
import { handleLocations } from "./locations/routes.js";
import { handleResources } from "./resources/routes.js";
import { handleTags } from "./tags/routes.js";
import { handleData } from "./data/routes.js";
import { handleMedia } from "./media/routes.js";
import { sweepOrphans } from "./media/storage.js";
import { cleanUp } from "./cleanup.js";

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    // Errors are caught here, around everything (signing in included), so
    // even a failure gets a friendly answer with the security headers.
    let response;
    try {
      response = await respond(request, env);
    } catch (err) {
      response = errorResponse(err);
    }
    return withSecurityHeaders(response);
  },

  /**
   * The daily cron trigger (wrangler.jsonc): clears ended sessions and
   * expired sign-in challenges, and photo files left without a row.
   * @param {ScheduledController} _controller
   * @param {Env} env
   */
  async scheduled(_controller, env) {
    await cleanUp(env.DB);
    await sweepOrphans(env.DB, env.PHOTOS);
  },
};

/**
 * @param {Request} request
 * @param {Env} env
 * @returns {Promise<Response>}
 */
async function respond(request, env) {
  const url = new URL(request.url);

  // Not an API request? Serve the page files.
  if (!url.pathname.startsWith("/api/")) {
    return env.ASSETS.fetch(request);
  }

  if (!isAllowedOrigin(request, env.ORIGIN)) {
    return json({ error: "Not allowed" }, 403);
  }

  // Signing up, in and out: no session needed, but a limit on attempts.
  if (url.pathname.startsWith("/api/auth/")) {
    const { success } = await env.AUTH_RATE_LIMIT.limit({ key: rateLimitKey(request) });
    if (!success) return json({ error: "Too many attempts. Wait a minute and try again." }, 429);
    return (await handleAuth(request, env, url)) ?? notFound();
  }

  // Figure out who is asking. Every other API request needs a signed-in user.
  const user = await getUser(request, env);
  if (!user) {
    return json({ error: "Not signed in" }, 401);
  }
  if (user.session.kind === "recovery" && !allowedInRecovery(request.method, url.pathname)) {
    return json({ error: "Add a passkey to finish signing in.", recovery: true }, 403);
  }

  return (
    (await handleAccount(request, env, user, url)) ??
    (await handleKeys(request, env, user, url)) ??
    (await handleEncryption(request, env, user, url)) ??
    (await handleTies(request, env, user, url)) ??
    // Before resources: /api/locations/coords would look like an item there.
    (await handleLocations(request, env, user, url)) ??
    (await handleResources(request, env, user, url)) ??
    (await handleTags(request, env, user, url)) ??
    (await handleData(request, env, user, url)) ??
    (await handleMedia(request, env, user, url)) ??
    notFound()
  );
}
