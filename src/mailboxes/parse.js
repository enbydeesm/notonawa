// Mailboxes (format 2): where connected accounts' devices leave each other
// sealed messages. A mailbox is written to with its token and no session,
// so a message isn't tied to its sender's account; only its owner reads it.
// Pure, so it's easy to test.

import { BadInput } from "../http.js";

/**
 * How long an invite's intro mailbox lasts: as long as the invite, as its
 * maker chose it (the share's own choices, src/shares/parse.js's EXPIRY;
 * a test keeps them in step), so someone who opened it can accept for as
 * long as it's offered. "never": until its maker deletes it (revoking the
 * invite), kept as NEVER (migration 0032's CHECK has every intro end).
 */
export const INTRO_EXPIRY = /** @type {const} */ ({
  "10m": 10 * 60_000, "1h": 60 * 60_000, "1d": 24 * 60 * 60_000, "7d": 7 * 24 * 60 * 60_000, "30d": 30 * 24 * 60 * 60_000,
  never: null,
});

/** An intro that lasts until it's deleted: an end no one reaches. */
export const NEVER = "9999-12-31T23:59:59Z";
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
  /** @type {string | null} */
  let expiresAt = null;
  if (kind === "intro") {
    if (!Object.hasOwn(INTRO_EXPIRY, body?.expires)) throw new BadInput("Choose how long the invite lasts.");
    const ms = INTRO_EXPIRY[/** @type {keyof typeof INTRO_EXPIRY} */ (body.expires)];
    expiresAt = ms === null ? NEVER : new Date(now + ms).toISOString().replace(/\.\d+Z$/, "Z");
  }
  return { id: parseMailboxId(body?.id), token: parseToken(body?.token), kind, expiresAt };
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
