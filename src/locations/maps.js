// Google Maps links: which ones we accept, and reading coordinates out of
// them. Pure: following a short link's redirects is in resolve.js.

/** @typedef {{ latitude: number, longitude: number }} Coords */

// google.com, google.co.uk, google.com.au, … with or without www./maps.
const GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:[a-z]{2,3}|com?\.[a-z]{2})$/;
const NUMBER = String.raw`-?\d{1,3}(?:\.\d+)?`;
const PAIR = new RegExp(String.raw`^\s*(${NUMBER})\s*,\s*(${NUMBER})\s*$`);
// The place's pin, in the data= part of a place link: …!3d51.5007!4d-0.1246
const PIN = new RegExp(String.raw`!3d(${NUMBER})!4d(${NUMBER})`, "g");
// Where the map is centred: /maps/place/…/@51.5007,-0.1246,17z
const VIEW = new RegExp(String.raw`@(${NUMBER}),(${NUMBER})`);
// Query parameters that can hold "lat,lng", most specific first.
const PARAMS = ["q", "query", "ll", "destination", "daddr", "center", "sll"];

/**
 * A short link that has to be followed to find out where it points:
 * maps.app.goo.gl/… or goo.gl/maps/….
 * @param {URL} url
 */
export function isShortLink(url) {
  return url.protocol === "https:" &&
    (url.hostname === "maps.app.goo.gl" || (url.hostname === "goo.gl" && url.pathname.startsWith("/maps")));
}

/**
 * Google's cookie consent page, which some short links redirect to first
 * (from Europe). The real link is in its ?continue=.
 * @param {URL} url
 */
export function isConsentPage(url) {
  return url.hostname === "consent.google.com";
}

/**
 * A Google Maps link, full or short. Only these are ever fetched.
 * @param {URL} url
 */
export function isMapsLink(url) {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (isShortLink(url) || isConsentPage(url)) return true;
  if (!GOOGLE_HOST.test(url.hostname)) return false;
  return url.hostname.startsWith("maps.") || url.pathname === "/maps" || url.pathname.startsWith("/maps/");
}

/**
 * Reads the coordinates in a full Google Maps link: the place's pin if there
 * is one, then a "lat,lng" query (?q=, ?ll=, …), then the point the map is
 * centred on. Null if it has none (e.g. a link with only a place name).
 * @param {URL} url
 * @returns {Coords | null}
 */
export function coordsFromMapsUrl(url) {
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname;
  }
  // A place link can hold several pins (nearby places); the place's own is last.
  const pins = [...path.matchAll(PIN)];
  const pin = pins.at(-1);
  if (pin) return toCoords(pin[1], pin[2]);
  for (const name of PARAMS) {
    const match = url.searchParams.get(name)?.replace(/^loc:/, "").match(PAIR);
    if (match) return toCoords(match[1], match[2]);
  }
  const view = path.match(VIEW);
  return view ? toCoords(view[1], view[2]) : null;
}

/**
 * @param {string} lat
 * @param {string} lng
 * @returns {Coords | null}
 */
function toCoords(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}
