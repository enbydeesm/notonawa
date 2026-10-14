// Location routes beyond the shared ones in resources/: finding a Google
// Maps link's coordinates for the location form.

import { BadInput, json, readJson } from "../http.js";
import { toUrlOrNull } from "../parse.js";
import { isMapsLink } from "./maps.js";
import { resolveMapsLink } from "./resolve.js";

/** @typedef {import("../auth/user.js").User} User */

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} _env
 * @param {User} _user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleLocations(request, _env, _user, url) {
  // POST /api/locations/coords { url } -> { latitude, longitude } read from a
  //   Google Maps link (both null if it has none). The link is in the body so
  //   it never goes in a URL. Short links are followed to Google.
  if (url.pathname === "/api/locations/coords" && request.method === "POST") {
    const link = toUrlOrNull((await readJson(request)).url);
    if (link === null) throw new BadInput("Paste a Google Maps link.");
    const mapsLink = new URL(link);
    if (!isMapsLink(mapsLink)) throw new BadInput("That isn't a Google Maps link.");
    const coords = await resolveMapsLink(mapsLink, fetch);
    return json(coords ?? { latitude: null, longitude: null });
  }
  return null;
}
