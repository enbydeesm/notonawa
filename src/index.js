// Rope Journal - Worker script
// Sits between your pages (in /public) and the database (env.DB).
// Anything under /api/ is handled here; everything else is served from /public.

import { getUser } from "./auth/user.js";
import { json, notFound } from "./http.js";
import { errorResponse } from "./errors.js";
import { handleTies } from "./ties/routes.js";
import { handleResources } from "./resources/routes.js";

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // Not an API request? Serve the page files.
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // Figure out who is asking. Every API request needs a known user.
    const user = await getUser(request, env);
    if (!user) {
      return json({ error: "Not signed in" }, 401);
    }

    try {
      return (
        (await handleTies(request, env, user, url)) ??
        (await handleResources(request, env, user, url)) ??
        notFound()
      );
    } catch (err) {
      return errorResponse(err);
    }
  },
};
