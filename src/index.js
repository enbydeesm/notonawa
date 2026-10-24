// NotoNawa - Worker script
// Sits between your pages (in /public) and the database (env.DB).
// Anything under /api/ is handled here; everything else is served from /public.

import { getUser } from "./auth/user.js";
import { isAllowedOrigin, allowedInRecovery, rateLimitKey } from "./auth/guard.js";
import { needsConsent, allowedWithoutConsent } from "./consent/parse.js";
import { CONSENT_VERSION } from "./policy-version.js";
import { handleConsent } from "./consent/routes.js";
import { handleNotices } from "./notices/routes.js";
import { json, notFound } from "./http.js";
import { errorResponse } from "./errors.js";
import { withSecurityHeaders } from "./security-headers.js";
import { handleAuth } from "./auth/routes.js";
import { handleAccount } from "./account/routes.js";
import { handleKeys } from "./keys/routes.js";
import { handleEncryption } from "./encryption/routes.js";
import { handleTies } from "./ties/routes.js";
import { handleWorkshops } from "./workshops/routes.js";
import { handleLocations } from "./locations/routes.js";
import { handleResources } from "./resources/routes.js";
import { handleTags } from "./tags/routes.js";
import { handleData } from "./data/routes.js";
import { handleMedia } from "./media/routes.js";
import { handleDrawings } from "./drawings/routes.js";
import { handlePoses } from "./poses/routes.js";
import { handleVisuals } from "./visuals/routes.js";
import { handleStats } from "./stats/routes.js";
import { handleFeedback } from "./feedback/routes.js";
import { handleShares } from "./shares/routes.js";
import { cleanUpShares } from "./shares/cleanup.js";
import { sweepOrphans } from "./media/storage.js";
import { cleanUp } from "./cleanup.js";
import { takeBackup } from "./backup/run.js";

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
   * The daily cron trigger (wrangler.jsonc): backs up the database (keeping
   * 30 days), then clears ended sessions and expired sign-in challenges,
   * shares that have ended, and photo and share files left without a row.
   * Each runs even if one before it fails.
   * @param {ScheduledController} _controller
   * @param {Env} env
   */
  async scheduled(_controller, env) {
    const jobs = [
      // The dev environment (wrangler.jsonc) has neither the key nor the bucket.
      ["backup", () => (env.BACKUP_PUBLIC_KEY && env.BACKUPS
        ? takeBackup(env.DB, env.BACKUPS, env.BACKUP_PUBLIC_KEY)
        : Promise.reject(new Error("BACKUP_PUBLIC_KEY or BACKUPS isn't set: no backup taken.")))],
      ["clean-up", () => cleanUp(env.DB)],
      ["share clean-up", () => cleanUpShares(env.DB, env.PHOTOS)],
      ["photo sweep", () => sweepOrphans(env.DB, env.PHOTOS)],
    ];
    let failed = false;
    for (const [name, job] of /** @type {[string, () => Promise<unknown>][]} */ (jobs)) {
      try {
        await job();
      } catch (err) {
        failed = true;
        console.error(`Daily ${name} failed:`, err instanceof Error ? err.message : err);
      }
    }
    // Shows the run as failed in Cloudflare's Cron Events.
    if (failed) throw new Error("A daily job failed (see the messages above).");
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
  // The privacy policy changed in a way that needs agreeing to again:
  // nothing new is saved until they do (GET /api/consent tells the page).
  if (needsConsent(user.termsVersion, CONSENT_VERSION) && !allowedWithoutConsent(request.method, url.pathname)) {
    return json({ error: "Please agree to the updated privacy policy first.", consent: true }, 403);
  }

  return (
    (await handleConsent(request, env, user, url)) ??
    (await handleNotices(request, env, user, url)) ??
    (await handleAccount(request, env, user, url)) ??
    (await handleKeys(request, env, user, url)) ??
    (await handleEncryption(request, env, user, url)) ??
    (await handleTies(request, env, user, url)) ??
    (await handleWorkshops(request, env, user, url)) ??
    // Before resources: /api/locations/coords would look like an item there.
    (await handleLocations(request, env, user, url)) ??
    (await handleResources(request, env, user, url)) ??
    (await handleTags(request, env, user, url)) ??
    (await handleData(request, env, user, url)) ??
    (await handleMedia(request, env, user, url)) ??
    (await handleDrawings(request, env, user, url)) ??
    (await handlePoses(request, env, user, url)) ??
    (await handleVisuals(request, env, user, url)) ??
    (await handleStats(request, env, user, url)) ??
    (await handleFeedback(request, env, user, url)) ??
    (await handleShares(request, env, user, url)) ??
    notFound()
  );
}
