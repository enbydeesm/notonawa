// The service worker: only for push notifications (public/js/push.js
// registers it once they're turned on). It shows what a push says and
// opens the app when one is tapped. It caches nothing and handles no
// requests, so nothing of the journal is ever kept or served from here.
//
// A push is sealed to this device (Web Push), and holds only the words the
// server can know: "something new from a connection", or a notice from us
// (src/push/parse.js). A plain script with no imports: module service
// workers aren't in every browser yet.

// The page's types, not a service worker's, are what the type check knows.
const sw = /** @type {any} */ (self);

sw.addEventListener("push", (/** @type {any} */ event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    // Not ours: still shown, as browsers require of every push.
  }
  const title = typeof message.title === "string" ? message.title : "NōtoNawa";
  event.waitUntil(sw.registration.showNotification(title, {
    body: typeof message.body === "string" ? message.body : "",
    tag: typeof message.tag === "string" ? message.tag : undefined,
    icon: "/img/icon-192-v4.png",
    badge: "/img/icon-192-v4.png",
    data: { url: typeof message.url === "string" && message.url.startsWith("/") ? message.url : "/" },
  }));
});

// Tapped: back to the app if it's open, otherwise opened.
sw.addEventListener("notificationclick", (/** @type {any} */ event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil((async () => {
    const windows = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((/** @type {any} */ client) => new URL(client.url).origin === sw.location.origin);
    if (open) return open.focus();
    return sw.clients.openWindow(url);
  })());
});
