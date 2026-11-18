// Sending push notifications (Web Push, webpush.js) to an account's devices
// that want them: when a connection leaves something in one of my
// mailboxes (straight after, without slowing the sender), and notices from
// us posted with --push (every 5 minutes, by the cron trigger).
//
// Nothing is sent where VAPID_PRIVATE_KEY (a secret) or VAPID_PUBLIC_KEY
// isn't set. A push address the push service says is gone (404, 410) is
// deleted; any other failure is left for next time.

import { pushRequest } from "./webpush.js";
import { connectionMessage, noticeMessage } from "./parse.js";
import { deleteGone, mailboxOwner, noticePushedTo, noticeRecipients, noticesToPush, subscriptionsFor } from "./db.js";

export const SUBJECT = "mailto:contact@notonawa.app"; // who the push services can contact about our pushes
const CONNECTION_TTL = 24 * 60 * 60; // a day: by then the app shows it anyway
const NOTICE_TTL = 3 * 24 * 60 * 60;
export const NOTICE_BATCH = 200; // devices a notice goes to per run (the Worker's subrequests are limited)

/** @typedef {(url: string, init: RequestInit) => Promise<Response>} Fetcher */

/**
 * The VAPID keys, or null if this environment has none.
 * @param {Env} env
 */
export function vapidKeys(env) {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = /** @type {{ VAPID_PUBLIC_KEY?: string, VAPID_PRIVATE_KEY?: string }} */ (env);
  return publicKey && privateKey ? { publicKey, privateKey } : null;
}

/**
 * Sends one message to each device, deleting the ones that are gone.
 * @param {Env} env
 * @param {import("./db.js").Subscription[]} subscriptions
 * @param {import("./parse.js").PushMessage} message
 * @param {{ topic: string, ttl: number }} options
 * @param {Fetcher} [fetcher]
 * @returns {Promise<{ sent: number, gone: number }>}
 */
export async function sendTo(env, subscriptions, message, { topic, ttl }, fetcher = fetch) {
  const keys = vapidKeys(env);
  if (!keys || subscriptions.length === 0) return { sent: 0, gone: 0 };
  /** @type {string[]} */
  const gone = [];
  let sent = 0;
  await Promise.all(subscriptions.map(async (sub) => {
    try {
      const { url, init } = await pushRequest(sub, message, { topic, ttl, subject: SUBJECT, ...keys });
      const res = await fetcher(url, init);
      if (res.status === 404 || res.status === 410) gone.push(sub.id);
      else if (res.ok) sent++;
    } catch {
      // The push service couldn't be reached: next time.
    }
  }));
  await deleteGone(env.DB, gone);
  return { sent, gone: gone.length };
}

/**
 * A message landed in a mailbox: its owner's devices that want
 * connections' notifications get one. Pushes still waiting for an offline
 * device are replaced by the newest (one topic), not piled up.
 * @param {Env} env
 * @param {string} mailboxId
 * @param {Fetcher} [fetcher]
 */
export async function notifyMailboxOwner(env, mailboxId, fetcher = fetch) {
  if (!vapidKeys(env)) return { sent: 0, gone: 0 };
  const owner = await mailboxOwner(env.DB, mailboxId);
  if (!owner) return { sent: 0, gone: 0 };
  return sendTo(env, await subscriptionsFor(env.DB, owner, "connections"), connectionMessage(),
    { topic: "connections", ttl: CONNECTION_TTL }, fetcher);
}

/**
 * Notices posted with --push that are showing now: sent to the next
 * devices that want announcements (NOTICE_BATCH a run, across notices),
 * picking up where the last run got to.
 * @param {Env} env
 * @param {Fetcher} [fetcher]
 */
export async function pushNotices(env, fetcher = fetch) {
  if (!vapidKeys(env)) return;
  let room = NOTICE_BATCH;
  for (const notice of await noticesToPush(env.DB)) {
    if (room === 0) return;
    const recipients = await noticeRecipients(env.DB, notice, room);
    room -= recipients.length;
    await sendTo(env, recipients, noticeMessage(notice), { topic: `notice-${notice.id.slice(0, 24)}`, ttl: NOTICE_TTL }, fetcher);
    const cursor = recipients.at(-1)?.id ?? notice.push_cursor;
    await noticePushedTo(env.DB, notice.id, cursor, room > 0);
  }
}
