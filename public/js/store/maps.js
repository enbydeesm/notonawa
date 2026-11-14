// A Google Maps link's coordinates, for the location form (both formats).
// A full link is read here on the device (maps.js), so it never leaves it;
// only a short link (maps.app.goo.gl, goo.gl/maps), which has to be
// followed to find out where it points, goes to the server's
// POST /api/locations/coords.

import { api } from "../api.js";
import { isMapsLink, isShortLink, isConsentPage, coordsFromMapsUrl } from "../maps.js";

/**
 * @param {string} link
 * @returns {Promise<{ latitude: number | null, longitude: number | null }>} both null if it has none
 */
export async function mapLinkCoords(link) {
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    throw new Error("Paste a Google Maps link.");
  }
  if (!isMapsLink(url)) throw new Error("That isn't a Google Maps link.");
  if (isShortLink(url) || isConsentPage(url)) return api("/api/locations/coords", { method: "POST", body: { url: url.href } });
  return coordsFromMapsUrl(url) ?? { latitude: null, longitude: null };
}
