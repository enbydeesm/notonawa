// Push notifications: what a device sends to subscribe, and the words of
// each notification. Pure, so it's easy to test.

import { BadInput } from "../http.js";

// The push services browsers use, by host: the Worker only ever sends to
// these, so a subscription can't make it post to any other address.
// Chrome, Edge on Android, Samsung Internet, Opera: Google's FCM. Safari:
// Apple's. Firefox: Mozilla's. Edge on Windows: Microsoft's WNS.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
const MAX_ENDPOINT = 2048;
const P256DH = /^[A-Za-z0-9_-]{87}$/; // a 65-byte P-256 public key
const AUTH = /^[A-Za-z0-9_-]{22}$/; // a 16-byte secret

const NOT_PUSH = "That isn't a push address this app can use.";

/**
 * A push address: https, on one of the push services.
 * @param {unknown} value
 * @returns {string}
 */
export function parseEndpoint(value) {
  if (typeof value !== "string" || value.length > MAX_ENDPOINT) throw new BadInput(NOT_PUSH);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BadInput(NOT_PUSH);
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password || !PUSH_HOSTS.some((host) => host.test(url.hostname))) {
    throw new BadInput(NOT_PUSH);
  }
  return value;
}

/**
 * POST /api/push/subscription's body: the browser's subscription (its
 * toJSON()) and which kinds this device wants.
 * @param {Record<string, any>} body
 * @returns {{ endpoint: string, p256dh: string, auth: string, connections: boolean, announcements: boolean }}
 */
export function parseSubscription(body) {
  const endpoint = parseEndpoint(body.endpoint);
  const { p256dh, auth } = body.keys ?? {};
  if (typeof p256dh !== "string" || !P256DH.test(p256dh) || typeof auth !== "string" || !AUTH.test(auth)) {
    throw new BadInput("That device's notification keys aren't right. Turn notifications off and on again.");
  }
  if (typeof body.connections !== "boolean" || typeof body.announcements !== "boolean") {
    throw new BadInput("Choose which notifications you'd like.");
  }
  return { endpoint, p256dh, auth, connections: body.connections, announcements: body.announcements };
}

/** The kinds of notification, each a column of push_subscriptions. */
export const KINDS = /** @type {const} */ (["connections", "announcements"]);

/**
 * @typedef {{ title: string, body: string, tag: string, url: string }} PushMessage
 *   what public/sw.js shows; tag: one with the same tag replaces it on the device
 */

/**
 * A connection left something in one of my mailboxes. The server can't
 * tell what or from whom, so it can't say.
 * @returns {PushMessage}
 */
export function connectionMessage() {
  return { title: "NōtoNawa", body: "You have something new from a connection. Open NōtoNawa to see it.", tag: "connections", url: "/" };
}

const NOTICE_BODY = 300; // characters: longer notices are cut, the rest in the app

/**
 * A notice from us, sent with --push.
 * @param {{ id: string, message: string }} notice
 * @returns {PushMessage}
 */
export function noticeMessage({ id, message }) {
  const body = message.length > NOTICE_BODY ? `${message.slice(0, NOTICE_BODY - 1).trimEnd()}…` : message;
  return { title: "NōtoNawa", body, tag: `notice-${id}`, url: "/" };
}
