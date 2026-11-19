// The walkthrough's push chunk: the one-time offer of notifications, and
// Settings' Notifications on this device. Headless Chrome can't really
// subscribe with a push service, so the browser's answers (permission, the
// subscription) are faked in the page; the service worker is registered for
// real (the CSP's Trusted Types policy for it), and the server keeps what
// the device sends. Nothing is pushed: the walkthrough has no private key.

import { check, freshAccount, go, run, sql } from "../harness.mjs";

// The browser's answers, faked: the permission it gives, and a subscription
// with a push service (Google's, as Chrome's would be).
const FAKE = (/** @type {"granted" | "denied"} */ answer) => `
  let permission = "default";
  Object.defineProperty(Notification, "permission", { get: () => permission, configurable: true });
  Notification.requestPermission = async () => (permission = ${JSON.stringify(answer)});
  const key = (n) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  let subscription = null;
  const fake = { endpoint: "https://fcm.googleapis.com/fcm/send/walkthrough-" + crypto.randomUUID(), keys: { p256dh: "B" + key(64).slice(0, 86), auth: key(16) } };
  PushManager.prototype.getSubscription = async () => subscription;
  PushManager.prototype.subscribe = async () => (subscription = {
    endpoint: fake.endpoint, toJSON: () => ({ endpoint: fake.endpoint, keys: fake.keys }), unsubscribe: async () => { subscription = null; return true; },
  });
  window.__fakeEndpoint = fake.endpoint;`;

const BANNER_NOW = `[$("#push-offer").hidden, $("#push-offer-text")?.textContent, [...document.querySelectorAll("#push-offer button")].map((b) => b.textContent)]`;
const BANNER = `return ${BANNER_NOW};`;

/** @param {string} endpoint */
const row = (endpoint) => sql(`SELECT connections, announcements FROM push_subscriptions WHERE endpoint = '${endpoint}'`);

export default async function () {
  console.log("Push notifications");
  await freshAccount();
  // The install banner first, as it comes before this offer (this Chrome offers installing).
  await run(`sessionStorage.setItem("ui-push-banner", "1"); localStorage.removeItem("push-asked"); localStorage.setItem("install-dismissed", "1");`);
  await go("/");
  check("after unlocking, a one-time banner offers notifications", await run(BANNER), [false,
    "nōtonawa can now send you push notifications when a connection sends you something or announcements are made. "
    + "Would you like to allow notifications?", ["Allow", "Not now"]]);
  check("…Not now hides it, and it doesn't come back", await run(`
    $(".push-later").click(); await calm(200); const now = $("#push-offer").hidden;
    return [now, localStorage.getItem("push-asked")];`), [true, "1"]);
  await go("/plans");
  check("…on another view or a reload either", await run(`return $("#push-offer").hidden;`), true);

  // Allow, and the browser's question refused.
  await run(`localStorage.removeItem("push-asked");`);
  await go("/");
  check("Allow, refused in the browser's question, says where to allow them again", await run(`
    ${FAKE("denied")}
    $(".push-allow").click(); await calm(400);
    ${BANNER}`), [false, "Notifications are blocked for nōtonawa on this device. To allow them, open the site's settings "
    + "(the icon beside the address, or the app's info), set Notifications to Allow, and turn them on again here.", ["OK"]]);

  // Allow, and allowed.
  await run(`localStorage.removeItem("push-asked");`);
  await go("/");
  const on = await run(`
    ${FAKE("granted")}
    $(".push-allow").click();
    for (let i = 0; i < 50 && $("#push-offer-text")?.textContent.startsWith("nōtonawa can now"); i++) await wait(100);
    await calm(300);
    const registration = await navigator.serviceWorker.getRegistration("/");
    return [${BANNER_NOW}, registration?.active?.scriptURL.endsWith("/sw.js") ?? false, window.__fakeEndpoint];`);
  check("Allow, allowed: notifications are on, through the service worker", on.slice(0, 2),
    [[false, "Notifications are on for this device. Choose which ones in Settings.", ["OK"]], true]);
  check("…and the server keeps this device's subscription, both kinds on", row(on[2]), [{ connections: 1, announcements: 1 }]);

  check("Settings shows both kinds on; Announcements can be turned off for this device", await run(`
    $(".push-done").click(); await openMenu(); $(".menu-settings").click();
    for (let i = 0; i < 50 && !$("#settings-push-announcements"); i++) await wait(100);
    const before = [$("#settings-push-connections").getAttribute("aria-checked"), $("#settings-push-announcements").getAttribute("aria-checked")];
    $("#settings-push-announcements").click(); await calm(400);
    return [$(".settings-push h3").textContent, before, $("#settings-push-announcements").getAttribute("aria-checked"), $("#settings-push-message").textContent];`),
  ["Notifications on this device", ["true", "true"], "false", ""]);
  check("…which the server keeps", row(on[2]), [{ connections: 1, announcements: 0 }]);
  check("Turn off on this device stops them, and offers to turn them on again", await run(`
    $("#settings-push-off").click(); await calm(400);
    return [$("#settings-push-message").textContent, !!$("#settings-push-on"), $("#settings-push-hint")?.textContent];`),
  ["Notifications are off on this device.", true, "Get a notification when a connection sends you something, or when we post an announcement."]);
  check("…and the server has no subscription for it", row(on[2]), []);

  check("turned on again from Settings, then signing out stops them on this device", await run(`
    $("#settings-push-on").click();
    for (let i = 0; i < 50 && !$("#settings-push-connections"); i++) await wait(100);
    const back = !!$("#settings-push-connections");
    $(".settings-dialog .dialog-cancel").click(); await calm(200);
    await openMenu(); $(".menu-sign-out").click();
    for (let i = 0; i < 50 && location.pathname !== "/signin"; i++) await wait(100);
    return [back, location.pathname];`), [true, "/signin"]);
  check("…its subscription is gone from the server", row(on[2]), []);
}
