// Push notifications on this device: what's possible here, what the
// one-time banner and Settings show, and where to turn notifications back
// on once they're blocked. Pure, so it's easy to test; push.js does the
// rest.

import { STEPS } from "./install-rules.js";

/** localStorage: "1" once the banner has been answered on this device. */
export const ASKED_KEY = "push-asked";

export const BANNER_TEXT = "nōtonawa can now send you push notifications when a connection sends you something or "
  + "announcements are made. Would you like to allow notifications?";

/**
 * On this device, now:
 *   unsupported: the browser can't, or this environment sends none
 *   install-first: an iPhone or iPad, where only the installed app can
 *   blocked: notifications were refused, and the browser won't ask again
 *   off: they can be turned on
 *   on: this device gets this account's notifications
 * @typedef {"unsupported" | "install-first" | "blocked" | "off" | "on"} PushState
 */

/**
 * @param {{ canPush: boolean, configured: boolean, platform: import("./install-rules.js").Platform,
 *   installed: boolean, permission: "default" | "granted" | "denied" | null, subscribed: boolean }} device
 *   canPush: the browser has service workers, PushManager and Notification
 *   (an iPhone's Safari has them only in the installed app);
 *   configured: the server has a public key to subscribe with
 * @returns {PushState}
 */
export function pushState({ canPush, configured, platform, installed, permission, subscribed }) {
  if (!configured) return "unsupported";
  if (platform === "ios" && !installed) return "install-first";
  if (!canPush) return "unsupported";
  if (permission === "denied") return "blocked";
  return subscribed && permission === "granted" ? "on" : "off";
}

/**
 * Whether to show the one-time banner: once per device, where turning
 * them on is possible (or possible once installed), not over the install
 * banner (which says the same first, on an iPhone).
 * @param {{ state: PushState, asked: boolean, installOfferShown: boolean }} situation
 */
export function wantsBanner({ state, asked, installOfferShown }) {
  return !asked && !installOfferShown && (state === "off" || state === "install-first");
}

/**
 * Before allowing notifications on an iPhone or iPad: install the app.
 * @returns {string}
 */
export function installFirstText() {
  return `On iPhone and iPad, notifications need the app installed. ${(STEPS.ios ?? "").replace(/^Install nōtonawa as an app: /, "To install it: ")} `
    + "Then open it from your home screen and allow notifications there.";
}

/**
 * Where to allow notifications again after they were blocked: the browser
 * won't ask a second time.
 * @param {{ platform: import("./install-rules.js").Platform, installed: boolean, userAgent: string }} device
 */
export function blockedText({ platform, installed, userAgent }) {
  const start = "Notifications are blocked for nōtonawa on this device. ";
  if (platform === "ios" && installed) return `${start}To allow them, open the Settings app, then Notifications, then nōtonawa, and turn on Allow Notifications.`;
  if (platform === "mac-safari") return `${start}To allow them, open Safari's Settings, then Websites, then Notifications, and set nōtonawa to Allow.`;
  if (/Firefox\//.test(userAgent)) return `${start}To allow them, tap the icon beside the address, then clear the blocked Notifications permission, and turn them on again here.`;
  return `${start}To allow them, open the site's settings (the icon beside the address, or the app's info), set Notifications to Allow, and turn them on again here.`;
}
