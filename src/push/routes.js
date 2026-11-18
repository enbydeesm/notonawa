// Routes for push notifications on this device (migration 0035). A device
// is known by its push address, sent in the body (it's a URL with a token
// in it: never in our paths).

import { json, readJson } from "../http.js";
import { parseEndpoint, parseSubscription } from "./parse.js";
import { deleteSubscription, saveSubscription, subscriptionKinds } from "./db.js";

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {import("../auth/user.js").User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handlePush(request, env, user, url) {
  const db = env.DB;

  // GET /api/push -> { public_key }: what a device subscribes with (our
  //   VAPID public key), or null where this environment sends none.
  if (url.pathname === "/api/push" && request.method === "GET") {
    return json({ public_key: /** @type {{ VAPID_PUBLIC_KEY?: string }} */ (env).VAPID_PUBLIC_KEY || null });
  }
  if (request.method !== "POST") return null;

  // POST /api/push/subscription  body { endpoint, keys: { p256dh, auth },
  //   connections, announcements } -> saves this device's subscription for
  //   me, with the kinds it wants (replacing another account's on it).
  if (url.pathname === "/api/push/subscription") {
    await saveSubscription(db, user.id, parseSubscription(await readJson(request)));
    return json({ ok: true });
  }

  // POST /api/push/subscription/status  body { endpoint } -> { subscribed,
  //   connections, announcements }: whether this device gets my
  //   notifications, and which.
  if (url.pathname === "/api/push/subscription/status") {
    const kinds = await subscriptionKinds(db, user.id, parseEndpoint((await readJson(request)).endpoint));
    return json({ subscribed: kinds !== null, connections: kinds?.connections === 1, announcements: kinds?.announcements === 1 });
  }

  // POST /api/push/subscription/delete  body { endpoint } -> this device
  //   gets no more of my notifications (turned off, or signing out).
  if (url.pathname === "/api/push/subscription/delete") {
    await deleteSubscription(db, user.id, parseEndpoint((await readJson(request)).endpoint));
    return json({ ok: true });
  }

  return null;
}
