// The app's views and their addresses, and which link clicks the app handles
// itself rather than leaving to the browser. Pure, so it's easy to test; the
// browser side is app.js.

/**
 * @typedef {"ties" | "plans" | "people" | "locations" | "account" | "data" | "signin" | "not-found"} ViewName
 * @typedef {{ path: string | null, view: ViewName, title: string, nav: boolean }} Route
 *   nav: whether the nav (tabs, + and the menu) is shown
 */

/** @type {Route[]} */
export const ROUTES = [
  { path: "/", view: "ties", title: "Rope Journal", nav: true },
  { path: "/plans", view: "plans", title: "Plans · Rope Journal", nav: true },
  { path: "/people", view: "people", title: "People · Rope Journal", nav: true },
  { path: "/locations", view: "locations", title: "Locations · Rope Journal", nav: true },
  { path: "/account", view: "account", title: "Account · Rope Journal", nav: true },
  { path: "/data", view: "data", title: "Your data · Rope Journal", nav: true },
  { path: "/signin", view: "signin", title: "Sign in · Rope Journal", nav: false },
];

/** @type {Route} */
export const NOT_FOUND = { path: null, view: "not-found", title: "Page not found · Rope Journal", nav: true };

/**
 * The route for a path, ignoring a trailing slash ("/plans/" is Plans).
 * @param {string} pathname
 * @returns {Route}
 */
export function matchRoute(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  return ROUTES.find((route) => route.path === path) ?? NOT_FOUND;
}

/**
 * Where a link click should take the app, or null to leave it to the browser:
 * links to other sites, to files and pages that aren't views (the privacy
 * policy, the CSV template), ones that open a new tab or download, and
 * clicks meant to open a new tab or window (Ctrl/⌘, Shift, middle button).
 * @param {{ href: string, target: string, download: boolean }} link
 * @param {{ button: number, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean, defaultPrevented: boolean }} click
 * @param {string} origin the app's own, e.g. location.origin
 * @returns {string | null} the path (with any query) to go to
 */
export function inAppTarget(link, click, origin) {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if ((link.target && link.target !== "_self") || link.download) return null;
  let url;
  try {
    url = new URL(link.href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || matchRoute(url.pathname) === NOT_FOUND) return null;
  return url.pathname + url.search + url.hash;
}
