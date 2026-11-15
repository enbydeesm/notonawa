// What contacts send each other (format 2), and reading what arrives,
// strictly: it comes from another account. Pure.
//
// - The acceptance: the one message sealed to my identity key (crypto/
//   pair.js), left in an invite's intro mailbox by whoever accepted it:
//   their public key and account id, their mailbox for me and its token, the
//   pair key we'll use from now on, and their profile if they shared it.
// - Then, sealed with the pair key, each into the other's mailbox:
//   "accepted" (the inviter's mailbox for them, key and account id),
//   "profile" (my shared profile, changed; shown as "Updated info
//   available", never applied by itself) and "removed" (silent: the
//   contact ends, and their About goes from my card of them if they asked).

import { readProfile } from "../profile-share.js";

export const MESSAGE_VERSION = 1;

const ID = /^[A-Za-z0-9_-]{16,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const USER = /^[A-Za-z0-9-]{1,64}$/;
// An X-Wing public key, 1,216 bytes in base64url.
const PUBLIC_KEY = /^[A-Za-z0-9_-]{1622}$/;

/**
 * @typedef {{ id: string, token: string }} MailboxAddress
 * @typedef {{ public_key: string, user_id: string, mailbox: MailboxAddress, pair_key: string,
 *   profile: import("../profile-share.js").SharedProfile | null }} Acceptance
 * @typedef {{ type: "accepted", public_key: string, user_id: string, mailbox: MailboxAddress }
 *   | { type: "profile", public_key: string, profile: import("../profile-share.js").SharedProfile }
 *   | { type: "removed", clear_about: boolean }} ContactMessage
 */

/** @param {unknown} v @returns {MailboxAddress | null} */
function mailboxOf(v) {
  const m = /** @type {any} */ (v);
  return m && typeof m === "object" && typeof m.id === "string" && ID.test(m.id) && typeof m.token === "string" && TOKEN.test(m.token)
    ? { id: m.id, token: m.token } : null;
}

/** @param {unknown} v */
const keyOf = (v) => (typeof v === "string" && PUBLIC_KEY.test(v) ? v : null);
/** @param {unknown} v */
const userOf = (v) => (typeof v === "string" && USER.test(v) ? v : null);

/**
 * The acceptance as sent.
 * @param {Acceptance} a
 */
export function acceptanceBody(a) {
  return { v: MESSAGE_VERSION, public_key: a.public_key, user_id: a.user_id, mailbox: a.mailbox, pair_key: a.pair_key,
    ...(a.profile ? { profile: a.profile } : {}) };
}

/**
 * An acceptance as it arrived (opened), or null if it isn't one.
 * @param {unknown} value
 * @returns {Acceptance | null}
 */
export function readAcceptance(value) {
  const a = /** @type {any} */ (value);
  if (!a || typeof a !== "object" || a.v !== MESSAGE_VERSION) return null;
  const publicKey = keyOf(a.public_key);
  const userId = userOf(a.user_id);
  const mailbox = mailboxOf(a.mailbox);
  const pairKey = typeof a.pair_key === "string" && TOKEN.test(a.pair_key) ? a.pair_key : null;
  if (!publicKey || !userId || !mailbox || !pairKey) return null;
  const profile = a.profile == null ? null : readProfile(a.profile);
  if (a.profile != null && !profile) return null;
  return { public_key: publicKey, user_id: userId, mailbox, pair_key: pairKey, profile };
}

/**
 * A message as sent.
 * @param {ContactMessage} m
 */
export function messageBody(m) {
  return { v: MESSAGE_VERSION, ...m };
}

/**
 * A message as it arrived (opened), or null if it isn't one we know.
 * @param {unknown} value
 * @returns {ContactMessage | null}
 */
export function readMessage(value) {
  const m = /** @type {any} */ (value);
  if (!m || typeof m !== "object" || m.v !== MESSAGE_VERSION) return null;
  if (m.type === "accepted") {
    const publicKey = keyOf(m.public_key);
    const userId = userOf(m.user_id);
    const mailbox = mailboxOf(m.mailbox);
    return publicKey && userId && mailbox ? { type: "accepted", public_key: publicKey, user_id: userId, mailbox } : null;
  }
  if (m.type === "profile") {
    const publicKey = keyOf(m.public_key);
    const profile = readProfile(m.profile);
    return publicKey && profile ? { type: "profile", public_key: publicKey, profile } : null;
  }
  if (m.type === "removed") return { type: "removed", clear_about: m.clear_about === true };
  return null;
}

/**
 * What a profile invite that offers to connect carries in its sealed
 * snapshot (format 2): the inviter's public key and the invite's intro
 * mailbox with its token. The snapshot is sealed with the link's key, which
 * the server never has, so it can't swap the key.
 * @typedef {{ public_key: string, mailbox: MailboxAddress }} InviteOffer
 */

/**
 * The offer as put in the snapshot.
 * @param {InviteOffer} offer
 */
export function offerBody(offer) {
  return { v: MESSAGE_VERSION, public_key: offer.public_key, mailbox: offer.mailbox };
}

/**
 * An invite's offer to connect, from its opened snapshot (its `connect`),
 * or null if it has none (or not one we can use).
 * @param {unknown} snapshot
 * @returns {InviteOffer | null}
 */
export function readInviteOffer(snapshot) {
  const c = /** @type {any} */ (snapshot)?.connect;
  if (!c || typeof c !== "object" || c.v !== MESSAGE_VERSION) return null;
  const publicKey = keyOf(c.public_key);
  const mailbox = mailboxOf(c.mailbox);
  return publicKey && mailbox ? { public_key: publicKey, mailbox } : null;
}
