// The version the server is running, so a page left open over a deploy can
// see it's out of date and reload (public/js/version-check.js). No session
// needed: it's asked for on the sign-in and Unlock views, and the version is
// shown on the sign-in page anyway.

import { json } from "../http.js";
import { APP_VERSION } from "../app-version.js";

/**
 * Returns a Response if the request is for this route, otherwise null.
 * @param {Request} request
 * @param {URL} url
 * @returns {Response | null}
 */
export function handleVersion(request, url) {
  // GET /api/version -> { version }: the newest release's, from RELEASES.md.
  if (url.pathname === "/api/version" && request.method === "GET") {
    return json({ version: APP_VERSION });
  }
  return null;
}
