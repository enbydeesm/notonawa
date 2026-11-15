// Contacts (format 2): each is a record of kind "contact", in my own sealed
// journal; nothing on the server says who it is. Pure.
//
// One is made at each step of connecting:
// - "invited": an invite of mine that offers to connect. It remembers the
//   share, its link's key (an acceptance is bound to it) and tag, whether
//   it's for one person, its intro mailbox, and what my profile shares (so
//   later updates send the same fields). The share itself may be gone by
//   the time an acceptance comes: a one-person invite goes once opened.
// - "active": connected. It pins their public key and holds their account
//   id (for the safety number), their mailbox for me and its token, my
//   mailbox for them, the pair key every later message is sealed with, a
//   counter for each direction, and the person it's on (none until I choose
//   one: the inviter's banner).
// - "removed": they removed me, or I removed them: kept, so a late message
//   isn't taken for a new contact, but shown nowhere.
//
// A key that changes clears the verified mark and shows "This contact's
// key changed", until they're verified again in person.

import { compact } from "../records/parse.js";

/**
 * @typedef {import("./messages.js").MailboxAddress} MailboxAddress
 * @typedef {import("./messages.js").Acceptance} Acceptance
 * @typedef {import("./messages.js").ContactMessage} ContactMessage
 * @typedef {import("../profile-share.js").SharedProfile} SharedProfile
 * @typedef {Record<string, any>} Body
 */

/**
 * My invite, waiting to be accepted.
 * @param {{ shareId: string, linkKey: string, label: string | null, once: boolean, introMailbox: string,
 *   fields: Record<string, boolean>, now: string }} invite
 * @returns {Body}
 */
export function invitedContact({ shareId, linkKey, label, once, introMailbox, fields, now }) {
  return compact({
    state: "invited", share_id: shareId, link_key: linkKey, label: label || null, once, intro_mailbox: introMailbox, fields,
    created_at: now, updated_at: now,
  });
}

/**
 * My side, accepting someone's invite: connected, waiting for their
 * "accepted" with their mailbox for me.
 * @param {{ theirKey: string, personId: string, name: string, myMailbox: string, pairKey: string,
 *   fields: Record<string, boolean>, now: string }} accept
 * @returns {Body}
 */
export function acceptingContact({ theirKey, personId, name, myMailbox, pairKey, fields, now }) {
  return compact({
    state: "active", invited: false, answered: true, person_id: personId, name, their_key: theirKey, their_user: null,
    their_mailbox: null, my_mailbox: myMailbox, pair_key: pairKey, sent: 0, received: 0, fields, verified: false,
    key_changed: false, created_at: now, updated_at: now,
  });
}

/**
 * The inviter's side, from someone's acceptance: connected, on no one until
 * I choose (the banner's Add to a Person, New Person, Not now).
 * @param {{ invite: Body, acceptance: Acceptance, myMailbox: string, now: string }} from
 * @returns {Body}
 */
export function contactFromAcceptance({ invite, acceptance, myMailbox, now }) {
  return compact({
    state: "active", invited: true, answered: false, person_id: null, name: acceptance.profile?.name ?? null,
    label: invite.label ?? null, share_id: invite.share_id, their_key: acceptance.public_key, their_user: acceptance.user_id, their_mailbox: acceptance.mailbox,
    my_mailbox: myMailbox, pair_key: acceptance.pair_key, sent: 0, received: 0, fields: invite.fields ?? {},
    verified: false, key_changed: false, pending_profile: acceptance.profile ?? null, created_at: now, updated_at: now,
  });
}

/**
 * Pins their key: one that differs from the one I have clears the
 * verified mark and marks the change, until they're verified again.
 * @param {Body} body
 * @param {string} key
 * @returns {Body}
 */
export function withTheirKey(body, key) {
  if (!body.their_key || body.their_key === key) return { ...body, their_key: key };
  return { ...body, their_key: key, key_changed: true, verified: false };
}

/**
 * A message from them, applied to my record of them, and what else it
 * does: clear their About from my card of them ("removed", if they asked).
 * @param {Body} body
 * @param {ContactMessage} message
 * @param {string} now
 * @returns {{ body: Body, clearAbout: boolean }}
 */
export function applyMessage(body, message, now) {
  if (message.type === "removed") {
    return { body: { ...body, state: "removed", updated_at: now }, clearAbout: message.clear_about };
  }
  const keyed = withTheirKey(body, message.public_key);
  if (message.type === "accepted") {
    return { body: { ...keyed, their_user: message.user_id, their_mailbox: message.mailbox, updated_at: now }, clearAbout: false };
  }
  return { body: { ...keyed, pending_profile: message.profile, updated_at: now }, clearAbout: false };
}

/**
 * The next counter to send with, reserved: the body to save before sending
 * (a save another of my devices beat is refused, so two never send the
 * same counter, which they would refuse as a replay).
 * @param {Body} body
 * @returns {{ body: Body, counter: number }}
 */
export function reserveCounter(body) {
  const counter = (body.sent ?? 0) + 1;
  return { body: { ...body, sent: counter }, counter };
}

/**
 * Whether a message's counter is new from them (above the last taken).
 * @param {Body} body
 * @param {number} counter
 */
export function isNewCounter(body, counter) {
  return Number.isSafeInteger(counter) && counter > (body.received ?? 0);
}

/**
 * Marked verified: the safety number checked in person, for the key they
 * have now.
 * @param {Body} body
 * @param {string} now
 * @returns {Body}
 */
export function verified(body, now) {
  return { ...body, verified: true, key_changed: false, updated_at: now };
}

/**
 * Whether it's a live contact (connected, not removed).
 * @param {Body | null | undefined} body
 */
export const isActive = (body) => body?.state === "active";

/**
 * A contact as the connection screens have them (connection-text.js's
 * Connection): Shared by me's Connections, People's link icon and the
 * inviter's banner work the same for both formats.
 * @param {{ id: string, body: Body }} contact
 */
export function asConnection({ id, body }) {
  return {
    id, person_id: body.person_id ?? null, invited: !!body.invited, answered: !!body.answered,
    // The inviter sees the invite's tag (as format 1's sealed label); the accepter, the name they shared.
    label: body.invited ? body.label ?? body.name ?? null : body.name ?? null,
    created_at: body.created_at,
  };
}
