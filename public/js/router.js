// The app's views and their addresses, and which link clicks the app handles
// itself rather than leaving to the browser. Pure, so it's easy to test; the
// browser side is app.js.

/**
 * @typedef {"ties" | "plans" | "people" | "locations" | "calendar" | "analytics" | "education" | "account" | "data" | "signin" | "not-found" | "unlock" | "consent" | "convert" | "open" | "verify" | "link"} ViewName
 * @typedef {{ path: string | null, view: ViewName, title: string, nav: boolean, needsKey: boolean, beforeConsent?: boolean }} Route
 *   nav: whether the nav (tabs, + and the menu) is shown
 *   needsKey: shown only once the journal is unlocked (otherwise the Unlock
 *   view is shown in its place, at the same address)
 *   beforeConsent: still shown when the privacy policy has changed and I
 *   haven't agreed yet (exporting and deleting my account); other views
 *   that need the key show the Consent view in their place
 */

/** @type {Route[]} */
export const ROUTES = [
  { path: "/", view: "ties", title: "NotoNawa", nav: true, needsKey: true },
  { path: "/plans", view: "plans", title: "Plans · NotoNawa", nav: true, needsKey: true },
  { path: "/people", view: "people", title: "People · NotoNawa", nav: true, needsKey: true },
  { path: "/locations", view: "locations", title: "Locations · NotoNawa", nav: true, needsKey: true },
  { path: "/calendar", view: "calendar", title: "Calendar · NotoNawa", nav: true, needsKey: true },
  { path: "/analytics", view: "analytics", title: "Analytics · NotoNawa", nav: true, needsKey: true },
  { path: "/education", view: "education", title: "Education · NotoNawa", nav: true, needsKey: true },
  { path: "/account", view: "account", title: "Account · NotoNawa", nav: true, needsKey: true, beforeConsent: true },
  { path: "/data", view: "data", title: "Your data · NotoNawa", nav: true, needsKey: true, beforeConsent: true },
  // A share's link: /open#<id>.<key> (pending-share.js takes the key out).
  { path: "/open", view: "open", title: "Shared with you · NotoNawa", nav: true, needsKey: true },
  // A safety number scanned from a contact's phone: /verify#<60 digits>.
  { path: "/verify", view: "verify", title: "Verify · NotoNawa", nav: true, needsKey: true },
  // A new device's sign-in request, scanned from its screen: /link#<id>.<key hash>
  // (pending-link.js takes it out).
  { path: "/link", view: "link", title: "Sign in on a new device · NotoNawa", nav: true, needsKey: true },
  { path: "/signin", view: "signin", title: "Sign in · NotoNawa", nav: false, needsKey: false },
];

/** @type {Route} */
export const NOT_FOUND = { path: null, view: "not-found", title: "Page not found · NotoNawa", nav: true, needsKey: false };

/** Shown in place of a view that needs the key while the journal is locked. @type {Route} */
export const UNLOCK = { path: null, view: "unlock", title: "Unlock · NotoNawa", nav: false, needsKey: false };

/** Shown in place of the journal until I agree to a changed privacy policy. @type {Route} */
export const CONSENT = { path: null, view: "consent", title: "Privacy policy update · NotoNawa", nav: false, needsKey: false };

/**
 * Shown in place of the journal while a format 1 account converts to format
 * 2 (as Consent is: Your data and Account still open). @type {Route}
 */
export const CONVERT = { path: null, view: "convert", title: "Updating your journal · NotoNawa", nav: false, needsKey: false };

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
