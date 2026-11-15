// Routes for mailboxes (format 2): where connected accounts' devices leave
// each other sealed messages. Sending needs only the mailbox's token, not a
// session (the page sends it without cookies), so the server sees that a
// mailbox got a message, and when, but not from whom.

import { json, notFound, noContent, readJson } from "../http.js";
import { sha256Hex } from "../auth/session.js";
import { rateLimitKey } from "../auth/guard.js";
import { parseNewMailbox, parseMailboxId, parseMessage, parseAck } from "./parse.js";
import { addMailbox, deleteMailbox, deliver, listMessages, ackMessages } from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

const SEND_PATH = /^\/api\/mailboxes\/([^/]+)\/messages$/;
const ONE_PATH = /^\/api\/mailboxes\/([^/]+)$/;

/**
 * POST /api/mailboxes/:id/messages  body { token, slot?: "profile", body }
 *   -> 204: leaves a sealed message. No session: routed before signing in
 *   is checked, and any cookie sent is ignored. A wrong token and an
 *   unknown (or expired) mailbox are the same 404; 429 when it has 100
 *   waiting or this address has sent too many. A profile message replaces
 *   one waiting.
 * @param {Request} request
 * @param {Env} env
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleMailboxSend(request, env, url) {
  const send = url.pathname.match(SEND_PATH);
  if (!send || request.method !== "POST") return null;
  const { success } = await env.MAILBOX_RATE_LIMIT.limit({ key: rateLimitKey(request) });
  if (!success) return json({ error: "Too many messages. Wait a minute and try again." }, 429);
  const id = parseMailboxId(send[1]);
  const message = parseMessage(await readJson(request));
  const result = await deliver(env.DB, id, await sha256Hex(message.token), message);
  if (result === "unknown") return notFound();
  if (result === "full") return json({ error: "That mailbox is full. Try again later." }, 429);
  return noContent();
}

/**
 * The signed-in mailbox routes. Returns a Response if the request is for
 * one of them, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleMailboxes(request, env, user, url) {
  if (!url.pathname.startsWith("/api/mailboxes")) return null;
  const { method } = request;

  // POST /api/mailboxes  body { id, token, kind: "intro" | "contact", expires }
  //   -> 201: a mailbox of mine. The device makes the id and token; only the
  //   token's hash is kept. An intro (an invite's) lasts as long as the
  //   invite, expires being its choice (10m, 1h, 1d, 7d, 30d or never: until
  //   deleted).
  if (url.pathname === "/api/mailboxes" && method === "POST") {
    const { token, ...mailbox } = parseNewMailbox(await readJson(request), Date.now());
    if (!(await addMailbox(env.DB, user.id, { ...mailbox, tokenHash: await sha256Hex(token) }))) {
      return json({ error: "You have too many mailboxes. Remove a contact to add another." }, 400);
    }
    return json({ id: mailbox.id, expires_at: mailbox.expiresAt }, 201);
  }

  // GET /api/mailboxes/messages -> [{ id, mailbox_id, slot, body,
  //   created_at }]: every message waiting in my mailboxes, oldest first
  if (url.pathname === "/api/mailboxes/messages" && method === "GET") return json(await listMessages(env.DB, user.id));

  // POST /api/mailboxes/messages/ack  body { ids } -> { deleted }: deletes
  //   messages of mine once my device has applied and synced them
  if (url.pathname === "/api/mailboxes/messages/ack" && method === "POST") {
    return json({ deleted: await ackMessages(env.DB, user.id, parseAck(await readJson(request))) });
  }

  // DELETE /api/mailboxes/:id -> deletes a mailbox of mine and its messages
  const one = url.pathname.match(ONE_PATH);
  if (one && method === "DELETE") {
    return (await deleteMailbox(env.DB, user.id, parseMailboxId(one[1]))) ? noContent() : notFound();
  }
  return null;
}
