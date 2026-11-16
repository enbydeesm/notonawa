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
 * @typedef {import("../profile-share.js").ProfileChoices} ProfileChoices
 * @typedef {import("../aliases.js").Alias} Alias
 * @typedef {Record<string, any>} Body
 */

/**
 * My invite, waiting to be accepted.
 * @param {{ shareId: string, linkKey: string, label: string | null, once: boolean, introMailbox: string,
 *   fields: Record<string, any>, sentProfile: SharedProfile, now: string }} invite fields: keptChoices's;
 *   sentProfile: the profile in the invite, so an update goes only when it differs
 * @returns {Body}
 */
export function invitedContact({ shareId, linkKey, label, once, introMailbox, fields, sentProfile, now }) {
  return compact({
    state: "invited", share_id: shareId, link_key: linkKey, label: label || null, once, intro_mailbox: introMailbox, fields,
    sent_profile: sentProfile, created_at: now, updated_at: now,
  });
}

/**
 * What an invite shared, kept for its updates: the choices, with the
 * aliases as themselves (their places in my list change as I edit it).
 * @param {ProfileChoices} choices
 * @param {Alias[]} myAliases
 * @returns {Body}
 */
export function keptChoices(choices, myAliases) {
  return { ...choices, aliases: choices.aliases.map((i) => myAliases[i]).filter(Boolean) };
}

/**
 * The choices for an update, from what was kept: the aliases shared that I
 * still have (one I've renamed or removed isn't shared any more).
 * @param {Body} fields keptChoices's
 * @param {Alias[]} myAliases
 * @returns {ProfileChoices}
 */
export function updateChoices(fields, myAliases) {
  const kept = Array.isArray(fields.aliases) ? fields.aliases : [];
  const same = (/** @type {Alias} */ a, /** @type {any} */ b) => a.platform === b?.platform && a.alias === b?.alias;
  return {
    name: String(fields.name ?? ""), pronouns: !!fields.pronouns, default_role: !!fields.default_role, based_in: !!fields.based_in,
    is_educator: !!fields.is_educator, about: !!fields.about,
    aliases: myAliases.flatMap((a, i) => (kept.some((k) => same(a, k)) ? [i] : [])),
  };
}

/**
 * Whether a contact should get my profile now: connected, with somewhere
 * to send it, something shared with them, and it differs from the last
 * they got.
 * @param {Body | null | undefined} body
 * @param {SharedProfile} profile
 */
export function needsProfile(body, profile) {
  return body?.state === "active" && !!body.their_mailbox && !!body.fields?.name
    && JSON.stringify(body.sent_profile ?? null) !== JSON.stringify(profile);
}

/**
 * My side, accepting someone's invite: connected, waiting for their
 * "accepted" with their mailbox for me.
 * @param {{ theirKey: string, personId: string, name: string, myMailbox: string, pairKey: string,
 *   fields: Record<string, any>, sentProfile?: SharedProfile | null, now: string }} accept fields and sentProfile:
 *   what I shared back in the acceptance, if anything
 * @returns {Body}
 */
export function acceptingContact({ theirKey, personId, name, myMailbox, pairKey, fields, sentProfile = null, now }) {
  return compact({
    state: "active", invited: false, answered: true, person_id: personId, name, their_key: theirKey, their_user: null,
    their_mailbox: null, my_mailbox: myMailbox, pair_key: pairKey, sent: 0, received: 0, fields, sent_profile: sentProfile, verified: false,
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
    sent_profile: invite.sent_profile ?? null,
    verified: false, key_changed: false, pending_profile: acceptance.profile ?? null, created_at: now, updated_at: now,
  });
}

/** The most ties, plans and workshops waiting from one contact. */
export const MAX_INBOX = 50;
/** How long one sent to me can be opened: its share's expiry, 30 days. */
export const SENT_DAYS = 30;

/**
 * What a contact sent me that I haven't opened yet, still openable.
 * @param {Body} body
 * @param {Date} now
 * @returns {{ kind: string, share_id: string, link_key: string, received_at: string }[]}
 */
export function waitingShares(body, now) {
  const cutoff = now.getTime() - SENT_DAYS * 24 * 60 * 60 * 1000;
  return (Array.isArray(body.inbox) ? body.inbox : []).filter((s) => Date.parse(s.received_at) > cutoff);
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
  if (message.type === "share") {
    // Waiting for me to open it (the banner), the oldest dropped past the most kept.
    const sent = { kind: message.kind, share_id: message.share_id, link_key: message.link_key, received_at: now };
    const inbox = [...(Array.isArray(body.inbox) ? body.inbox : []).filter((s) => s.share_id !== sent.share_id), sent].slice(-MAX_INBOX);
    return { body: { ...body, inbox, updated_at: now }, clearAbout: false };
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
 * @returns {import("../connection-text.js").Connection}
 */
export function asConnection({ id, body }) {
  return {
    // Their profile, if they shared it back on accepting my invite (the banner offers it).
    shared: body.invited && !body.answered ? body.pending_profile ?? null : null,
    id, person_id: body.person_id ?? null, invited: !!body.invited, answered: !!body.answered,
    // The inviter sees the invite's tag (as format 1's sealed label); the accepter, the name they shared.
    label: body.invited ? body.label ?? body.name ?? null : body.name ?? null,
    created_at: body.created_at,
  };
}
