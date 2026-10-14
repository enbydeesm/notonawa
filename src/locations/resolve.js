// Finding a Google Maps link's coordinates, following a short link's
// redirects (maps.app.goo.gl → google.com/maps/place/…/@lat,lng) when needed.
// fetch is passed in so tests can stand in for Google.

import { coordsFromMapsUrl, isConsentPage, isMapsLink, isShortLink } from "./maps.js";

/** @typedef {import("./maps.js").Coords} Coords */

const MAX_HOPS = 5;
const TIMEOUT_MS = 5000;

/**
 * Only short links are fetched, one redirect at a time, and only to Google
 * Maps addresses: the server never follows a link anywhere else. Null if
 * the coordinates can't be found (including when Google can't be reached).
 * @param {URL} link a link that passed isMapsLink
 * @param {typeof fetch} fetchFn
 * @returns {Promise<Coords | null>}
 */
export async function resolveMapsLink(link, fetchFn) {
  let url = link;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (isConsentPage(url)) {
      const next = toMapsLink(url.searchParams.get("continue"), url);
      if (!next) return null;
      url = next;
      continue;
    }
    if (!isShortLink(url)) return coordsFromMapsUrl(url);

    let response;
    try {
      response = await fetchFn(url.href, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      return null;
    }
    await response.body?.cancel();
    if (response.status < 300 || response.status >= 400) return null;
    const next = toMapsLink(response.headers.get("location"), url);
    if (!next) return null;
    url = next;
  }
  return null;
}

/**
 * @param {string | null} location
 * @param {URL} base
 * @returns {URL | null} the address, if it's a Google Maps link
 */
function toMapsLink(location, base) {
  if (!location) return null;
  try {
    const url = new URL(location, base);
    return isMapsLink(url) ? url : null;
  } catch {
    return null;
  }
}
