// Mailboxes (format 2): where connected accounts' devices leave each other
// sealed messages. A mailbox is written to with its token and no session,
// so a message isn't tied to its sender's account; only its owner reads it.
// Pure, so it's easy to test.

import { BadInput } from "../http.js";

/** An invite's intro mailbox lasts as long as an offer to connect did: a day. */
export const INTRO_MS = 24 * 60 * 60 * 1000;
/** Messages not fetched (and acknowledged) by then are deleted. */
export const MESSAGE_DAYS = 90;
/** Mailboxes an account can have: one per contact, and open invites. */
export const MAX_MAILBOXES = 1000;
/** Messages waiting in a mailbox, at most: a flood stops there. */
export const MAX_WAITING = 100;
/** A message's length (a profile, with its About, is the biggest). */
export const MAX_MESSAGE = 200_000;
/** Messages one acknowledgement deletes, at most. */
export const MAX_ACK = 500;

const ID = /^[A-Za-z0-9_-]{16,64}$/;
// 32 random bytes, base64url.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
// Sealed: base64url (an acceptance) or "m1.<counter>.<iv>.<ciphertext>".
const SEALED = /^[A-Za-z0-9_.-]+$/;

/**
 * @param {unknown} value
 * @param {string} what
 */
export function parseMailboxId(value, what = "mailbox") {
  if (typeof value !== "string" || !ID.test(value)) throw new BadInput(`That isn't a ${what}'s id.`);
  return value;
}

/** @param {unknown} value */
function parseToken(value) {
  if (typeof value !== "string" || !TOKEN.test(value)) throw new BadInput("That isn't a mailbox's token.");
  return value;
}

/**
 * POST /api/mailboxes's body: the device makes the id and token.
 * @param {any} body
 * @param {number} now
 * @returns {{ id: string, token: string, kind: "intro" | "contact", expiresAt: string | null }}
 */
export function parseNewMailbox(body, now) {
  const kind = body?.kind;
  if (kind !== "intro" && kind !== "contact") throw new BadInput("A mailbox is an invite's intro or a contact's.");
  return {
    id: parseMailboxId(body?.id), token: parseToken(body?.token), kind,
    expiresAt: kind === "intro" ? new Date(now + INTRO_MS).toISOString().replace(/\.\d+Z$/, "Z") : null,
  };
}

/**
 * POST /api/mailboxes/:id/messages's body.
 * @param {any} body
 * @returns {{ token: string, slot: "profile" | null, sealed: string }}
 */
export function parseMessage(body) {
  const slot = body?.slot ?? null;
  if (slot !== null && slot !== "profile") throw new BadInput("That isn't a message slot.");
  const sealed = body?.body;
  if (typeof sealed !== "string" || !SEALED.test(sealed)) throw new BadInput("Couldn't send: the message wasn't sealed.");
  if (sealed.length > MAX_MESSAGE) throw new BadInput("That message is too long.");
  return { token: parseToken(body?.token), slot, sealed };
}

/**
 * POST /api/mailboxes/messages/ack's ids.
 * @param {any} body
 * @returns {string[]}
 */
export function parseAck(body) {
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ACK) throw new BadInput(`Acknowledge up to ${MAX_ACK} messages at once.`);
  return [...new Set(ids.map((id) => parseMailboxId(id, "message")))];
}
