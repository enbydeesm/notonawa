// Push notifications on this device (src/push/; push-rules.js decides what
// to show): the service worker (public/sw.js), the browser's subscription
// with its push service, and which kinds this device wants, kept on the
// server with the subscription, per device.
//
// Turning them on asks the browser's permission first, straight from the
// tap: Safari only asks while the tap is still being handled, so nothing
// is awaited before it.

import { api } from "./api.js";
import { pushState } from "./push-rules.js";
import { platformOf } from "./install-rules.js";
import { isInstalled } from "./install-banner.js";

const SW_URL = "/sw.js";

// The CSP's Trusted Types rules let a script URL through only a named
// policy (trusted-types service-worker in public/_headers); this one allows
// just the service worker. Browsers without Trusted Types take the URL.
/** @type {any} */
const trustedTypes = /** @type {any} */ (globalThis).trustedTypes;
const policy = trustedTypes?.createPolicy("service-worker", {
  createScriptURL: (/** @type {string} */ url) => {
    if (url !== SW_URL) throw new TypeError(`Not the service worker: ${url}`);
    return url;
  },
});

/** @typedef {{ connections: boolean, announcements: boolean }} PushKinds */
/** @typedef {{ state: import("./push-rules.js").PushState } & PushKinds} PushStatus */

/** Our public key, asked for once a page. @type {Promise<string | null> | null} */
let publicKey = null;
const serverKey = () => (publicKey ??= api("/api/push").then((r) => r.public_key ?? null).catch(() => { publicKey = null; return null; }));

const canPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const platform = () => platformOf(navigator.userAgent, navigator.maxTouchPoints);

/** This device's subscription with its push service, if it has one. */
async function currentSubscription() {
  if (!canPush()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Where notifications stand on this device, for the signed-in account.
 * @returns {Promise<PushStatus>}
 */
export async function pushStatus() {
  const configured = (await serverKey()) !== null;
  const subscription = configured ? await currentSubscription().catch(() => null) : null;
  /** @type {PushKinds & { subscribed: boolean }} */
  let kinds = { subscribed: false, connections: true, announcements: true };
  if (subscription) {
    kinds = await api("/api/push/subscription/status", { method: "POST", body: { endpoint: subscription.endpoint } });
  }
  const state = pushState({
    canPush: canPush(), configured, platform: platform(), installed: isInstalled(),
    permission: "Notification" in window ? Notification.permission : null, subscribed: kinds.subscribed,
  });
  return { state, connections: kinds.connections, announcements: kinds.announcements };
}

/**
 * Turns notifications on for this device, both kinds to start with: asks
 * the browser's permission (call it straight from a tap), then subscribes.
 * @returns {Promise<PushStatus>} "blocked" if refused, "off" if the question was dismissed
 */
export async function turnOnPush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return pushStatus();
  const key = await serverKey();
  if (!key) throw new Error("Notifications aren't available here yet.");
  await navigator.serviceWorker.register(policy ? policy.createScriptURL(SW_URL) : SW_URL, { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64url(key) });
  await save(subscription, { connections: true, announcements: true });
  return pushStatus();
}

/**
 * Which kinds this device gets.
 * @param {PushKinds} kinds
 */
export async function setPushKinds(kinds) {
  const subscription = await currentSubscription();
  if (!subscription) throw new Error("Notifications are off on this device.");
  await save(subscription, kinds);
}

/** Turns notifications off on this device. */
export async function turnOffPush() {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api("/api/push/subscription/delete", { method: "POST", body: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe().catch(() => {});
}

/**
 * Before signing out (or after deleting the account, with serverToo
 * false: its rows are gone already): this device stops getting the
 * account's notifications, so someone else using it next doesn't. Plain
 * fetch, not api(), which would leave for the sign-in view on a 401 and
 * never settle; a failure doesn't stop signing out.
 * @param {{ serverToo?: boolean }} [options]
 */
export async function forgetPushDevice({ serverToo = true } = {}) {
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    if (serverToo) {
      await fetch("/api/push/subscription/delete", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => {});
    }
    await subscription.unsubscribe();
  } catch {
    // Signed out anyway; the push service drops an address no one uses.
  }
}

/**
 * @param {PushSubscription} subscription
 * @param {PushKinds} kinds
 */
async function save(subscription, kinds) {
  const { endpoint, keys } = /** @type {{ endpoint: string, keys: { p256dh: string, auth: string } }} */ (subscription.toJSON());
  await api("/api/push/subscription", { method: "POST", body: { endpoint, keys, ...kinds } });
}

/** @param {string} text */
function fromBase64url(text) {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
