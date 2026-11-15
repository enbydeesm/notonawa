// Contacts over the journal in memory (format 2): connecting accounts, as
// contact records (contacts/rules.js) and mailboxes the server holds
// sealed messages in (src/mailboxes/). What a contact sends is read
// strictly (contacts/messages.js): it comes from another account.
//
// - An invite that offers to connect makes an intro mailbox, lasting as
//   long as the invite, and puts my public key and its address and token in
//   the invite's sealed snapshot; a contact record "invited" remembers it.
// - Accepting one makes my mailbox for the inviter and a pair key, and
//   leaves the acceptance in the intro mailbox, sealed to the inviter's key
//   and bound to the link's.
// - My devices check my mailboxes (watchMailboxes): an acceptance becomes a
//   contact (the inviter's banner then asks who it is) and is answered
//   "accepted" with my mailbox for them; a message from a contact is applied
//   to its record. A message is acknowledged (deleted from the server)
//   only once what it says is saved, so a crash loses nothing.
// - Removing one tells them ("removed"), quietly: their device ends the
//   contact without saying so.

import { api } from "../../api.js";
import * as vault from "../../vault.js";
import { records, record, save } from "./journal.js";
import { newId } from "../../records/ids.js";
import { stamp } from "../../records/parse.js";
import { newPairKey } from "../../crypto/pair.js";
import { toBase64url, fromBase64url } from "../../crypto/keys.js";
import { acceptanceBody, readAcceptance, messageBody, readMessage, offerBody } from "../../contacts/messages.js";
import {
  invitedContact, acceptingContact, contactFromAcceptance, applyMessage, reserveCounter, isNewCounter, isActive, asConnection,
} from "../../contacts/rules.js";
import { webLock } from "../../cache/sync.js";

/** @typedef {import("../../contacts/messages.js").MailboxAddress} MailboxAddress */
/** @typedef {import("../../contacts/messages.js").InviteOffer} InviteOffer */

/** Sent on window when contacts change, as connections.js's CONNECTIONS_CHANGED (the same name). */
const CHANGED = "notonawa:connections-changed";
/** How often an open page checks my mailboxes. */
const CHECK_MS = 2 * 60 * 1000;

/** A mailbox that's gone (removed, or never there): its sender is told so. */
class Gone extends Error {}

/** @type {{ public_key: string, sealed_seed: string, user_id: string, opened: boolean } | null} what I know of my own key, until lock */
let me = null;
vault.onWipe(() => { me = null; });

/** My public key and account id, and my seed opened in the crypto Worker. */
async function myIdentity() {
  if (!me) {
    const [identity, keys] = await Promise.all([api("/api/identity"), api("/api/keys")]);
    me = { public_key: identity.public_key, sealed_seed: identity.sealed_seed, user_id: keys.user_id, opened: false };
  }
  if (!me.opened) {
    await vault.openIdentity({ publicKey: me.public_key, sealedSeed: me.sealed_seed });
    me.opened = true;
  }
  return me;
}

/** A new mailbox's address and token, made here. */
function newAddress() {
  return { id: toBase64url(crypto.getRandomValues(new Uint8Array(16))), token: toBase64url(crypto.getRandomValues(new Uint8Array(32))) };
}

/**
 * Leaves a sealed message in someone's mailbox: its token, and no cookie,
 * so it isn't tied to my account.
 * @param {MailboxAddress} to
 * @param {string} body
 * @param {"profile"} [slot]
 */
async function send(to, body, slot) {
  const res = await fetch(`/api/mailboxes/${encodeURIComponent(to.id)}/messages`, {
    method: "POST", credentials: "omit", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: to.token, body, ...(slot ? { slot } : {}) }),
  });
  if (res.status === 404) throw new Gone();
  if (!res.ok) throw new Error("Couldn't reach them. Check your connection and try again.");
}

/** @param {string} id */
const deleteMailbox = (id) => api(`/api/mailboxes/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});

/**
 * Makes a profile invite that offers to connect: its intro mailbox, the
 * offer in its snapshot, the share (saveShare, passed in), and the record
 * remembering it. If a step fails, the mailbox goes too.
 * @param {{ kind: "profile", data: Record<string, any>, label: string, expires: string, uses: string,
 *   fields: Record<string, any>, saveShare: (share: any) => Promise<{ id: string, key: string }> }} invite
 * @returns {Promise<{ id: string, key: string }>}
 */
export async function connectingInvite({ fields, saveShare, ...share }) {
  const { public_key: publicKey } = await myIdentity();
  const intro = newAddress();
  await api("/api/mailboxes", { method: "POST", body: { ...intro, kind: "intro", expires: share.expires } });
  try {
    const saved = await saveShare({ ...share, data: { ...share.data, connect: offerBody({ public_key: publicKey, mailbox: intro }) } });
    const body = invitedContact({ shareId: saved.id, linkKey: saved.key, label: share.label, once: share.uses !== "any",
      introMailbox: intro.id, fields, now: stamp() });
    await save({ writes: [{ kind: "contact", id: newId(), body }] });
    return saved;
  } catch (err) {
    await deleteMailbox(intro.id);
    throw err;
  }
}

/**
 * Accepts an invite's offer to connect, on one of my people: my mailbox for
 * them, a pair key, and the acceptance left in their intro mailbox.
 * @param {{ offer: any, personId: string, name: string, shareId: string, linkKey: string }} accept offer:
 *   an InviteOffer (offerIn)
 */
export async function acceptConnection({ offer: anyOffer, personId, name, shareId, linkKey }) {
  const offer = /** @type {InviteOffer} */ (anyOffer);
  const mine = await myIdentity();
  const box = newAddress();
  await api("/api/mailboxes", { method: "POST", body: { ...box, kind: "contact" } });
  const pairKey = newPairKey();
  try {
    const sealed = await vault.sealAcceptance({
      inviterPublicKey: offer.public_key, shareId, linkKey,
      payload: acceptanceBody({ public_key: mine.public_key, user_id: mine.user_id, mailbox: box, pair_key: pairKey, profile: null }),
    });
    await send(offer.mailbox, toBase64url(new Uint8Array(sealed)));
  } catch (err) {
    await deleteMailbox(box.id);
    throw err instanceof Gone ? new Error("This invite no longer offers to connect. Ask them for a new one.") : err;
  }
  const now = stamp();
  await save({ writes: [
    ...offOtherContacts(personId, null, now),
    { kind: "contact", id: newId(), body: acceptingContact({ theirKey: offer.public_key, personId, name, myMailbox: box.id, pairKey, fields: {}, now }) },
  ] });
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * The writes that take a person off any other contact: a person is on one.
 * @param {string} personId
 * @param {string | null} except
 * @param {string} now
 */
function offOtherContacts(personId, except, now) {
  return records("contact").filter((c) => c.id !== except && c.body?.person_id === personId).map((c) => {
    const { person_id: _gone, ...rest } = /** @type {Record<string, any>} */ (c.body);
    return { kind: /** @type {const} */ ("contact"), id: c.id, from: c.body ?? undefined, body: { ...rest, updated_at: now } };
  });
}

/**
 * My contacts, as the connection screens have them (newest first).
 * @returns {Promise<import("../../connection-text.js").Connection[]>}
 */
export async function listConnections() {
  return records("contact").filter((c) => isActive(c.body)).map((c) => asConnection(/** @type {any} */ (c)))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** @param {string} id */
function contactOf(id) {
  const c = record(id);
  if (!c || c.kind !== "contact") throw new Error("Not found");
  return c;
}

/**
 * Puts a contact on one of my people, taking it off any other; answered.
 * @param {string} id
 * @param {string} personId
 */
export async function setConnectionPerson(id, personId) {
  const c = contactOf(id);
  const now = stamp();
  await save({ writes: [
    ...offOtherContacts(personId, id, now),
    { kind: "contact", id, from: c.body ?? undefined, body: { ...c.body, person_id: personId, answered: true, updated_at: now } },
  ] });
}

/**
 * The inviter's Not now: answered, on no one.
 * @param {string} id
 */
export async function markConnectionAnswered(id) {
  const c = contactOf(id);
  await save({ writes: [{ kind: "contact", id, from: c.body ?? undefined, body: { ...c.body, answered: true, updated_at: stamp() } }] });
}

/**
 * Removes a contact: tells them ("removed", clearing my About from their
 * card of me if I ask), and deletes my mailbox for them.
 * @param {string} id
 * @param {"remove" | "keep"} about
 */
export async function deleteConnection(id, about) {
  const { body, counter } = await reserve(id, (b) => ({ ...b, state: "removed" }));
  if (body.their_mailbox) {
    const sealed = await vault.sealMessage({ pairKey: body.pair_key, mailboxId: body.their_mailbox.id, counter,
      payload: messageBody({ type: "removed", clear_about: about === "remove" }) });
    await send(body.their_mailbox, sealed).catch(() => {});
  }
  if (body.my_mailbox) await deleteMailbox(body.my_mailbox);
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * Reserves the next counter to send a contact a message with, saving it
 * (and change's edits) first. A save another of my devices beat is tried
 * again on the newer record, so no two messages share a counter. Saved
 * bodies are kept as given, so the record holding mine says it won.
 * @param {string} id
 * @param {(body: Record<string, any>) => Record<string, any>} [change]
 * @returns {Promise<{ body: Record<string, any>, counter: number }>}
 */
async function reserve(id, change = (b) => b) {
  for (let i = 0; i < 3; i++) {
    const reserved = reserveCounter(change(/** @type {Record<string, any>} */ (contactOf(id).body)));
    const next = { ...reserved.body, updated_at: stamp() };
    await save({ writes: [{ kind: "contact", id, body: next }] });
    if (record(id)?.body === next) return { body: next, counter: reserved.counter };
  }
  throw new Error("Another device is changing this at the same time. Try again in a moment.");
}

/**
 * The shares that are invites offering to connect (Shared by me says so).
 * @returns {Set<string>}
 */
export function connectingShares() {
  return new Set(records("contact").filter((c) => c.body?.state === "invited").map((c) => /** @type {string} */ (c.body?.share_id)));
}

/**
 * An invite revoked: its intro mailbox and its record go too.
 * @param {string} shareId
 */
export async function inviteRevoked(shareId) {
  const invites = records("contact").filter((c) => c.body?.state === "invited" && c.body.share_id === shareId);
  for (const invite of invites) await deleteMailbox(/** @type {string} */ (invite.body?.intro_mailbox));
  if (invites.length) await save({ deletes: invites.map((c) => ({ kind: /** @type {const} */ ("contact"), id: c.id })) });
}

/**
 * Checks my mailboxes and applies what's there, then acknowledges it.
 * One tab at a time per account.
 * @returns {Promise<number>} how many were applied
 */
export async function checkMailboxes() {
  const { user_id: userId } = me ?? (await api("/api/keys"));
  return webLock(`notonawa-mail-${userId}`)(async () => {
    /** @type {{ id: string, mailbox_id: string, body: string }[]} */
    const messages = await api("/api/mailboxes/messages");
    if (!messages.length) return 0;
    await myIdentity();
    /** @type {string[]} */
    const done = [];
    let applied = 0;
    for (const m of messages) {
      const contacts = records("contact");
      const invite = contacts.find((c) => c.body?.state === "invited" && c.body.intro_mailbox === m.mailbox_id);
      const contact = contacts.find((c) => c.body?.my_mailbox === m.mailbox_id);
      try {
        if (invite) {
          if (await fromIntro(invite, m)) applied++;
        } else if (contact && isActive(contact.body)) {
          if (await fromContact(contact, m)) applied++;
        }
        done.push(m.id);
      } catch (err) {
        // One that won't open, or isn't anything we know: dropped. Anything
        // else (offline): kept, for the next check.
        if (err instanceof vault.CantOpen || err instanceof Gone) done.push(m.id);
      }
    }
    if (done.length) await api("/api/mailboxes/messages/ack", { method: "POST", body: { ids: done } });
    if (applied) window.dispatchEvent(new Event(CHANGED));
    return applied;
  });
}

/**
 * An acceptance of my invite: a new contact, answered "accepted".
 * @param {{ id: string, body: Record<string, any> | null }} invite
 * @param {{ body: string }} message
 * @returns {Promise<boolean>} whether it made a contact
 */
async function fromIntro(invite, message) {
  const inviteBody = /** @type {Record<string, any>} */ (invite.body);
  const acceptance = readAcceptance(await vault.openAcceptance({
    shareId: inviteBody.share_id, linkKey: inviteBody.link_key, sealed: fromBase64url(message.body).slice().buffer,
  }));
  if (!acceptance) return false;
  // The same id on every device, so two applying it at once make one contact.
  const [contactId] = (await vault.recordIds({ converted: [{ table: "contacts", oldId: `${inviteBody.share_id}|${acceptance.pair_key}` }] })).converted;
  if (record(contactId)) return false;
  const box = newAddress();
  await api("/api/mailboxes", { method: "POST", body: { ...box, kind: "contact" } });
  const now = stamp();
  const reserved = reserveCounter(contactFromAcceptance({ invite: inviteBody, acceptance, myMailbox: box.id, now }));
  // A one-person invite is done once accepted: its intro and record go.
  const once = !!inviteBody.once;
  await save({
    writes: [{ kind: "contact", id: contactId, body: reserved.body }],
    deletes: once ? [{ kind: "contact", id: invite.id }] : [],
  });
  // Saved bodies are kept as given: another one there means another device's.
  if (record(contactId)?.body !== reserved.body) {
    // Another device made it first: mine isn't needed.
    await deleteMailbox(box.id);
    return false;
  }
  const mine = await myIdentity();
  const sealed = await vault.sealMessage({ pairKey: acceptance.pair_key, mailboxId: acceptance.mailbox.id, counter: reserved.counter,
    payload: messageBody({ type: "accepted", public_key: mine.public_key, user_id: mine.user_id, mailbox: box }) });
  await send(acceptance.mailbox, sealed);
  if (once) await deleteMailbox(inviteBody.intro_mailbox);
  return true;
}

/**
 * A message from a contact, applied to its record: accepted, a profile
 * update (kept for them to choose), or removed (quietly, their About taken
 * off my card of them if they asked).
 * @param {{ id: string, body: Record<string, any> | null }} contact
 * @param {{ mailbox_id: string, body: string }} message
 * @returns {Promise<boolean>} whether anything changed
 */
async function fromContact(contact, message) {
  const body = /** @type {Record<string, any>} */ (contact.body);
  const { counter, payload } = await vault.openMessage({ pairKey: body.pair_key, mailboxId: message.mailbox_id, sealed: message.body });
  if (!isNewCounter(body, counter)) return false;
  const read = readMessage(payload);
  const now = stamp();
  if (!read) {
    await save({ writes: [{ kind: "contact", id: contact.id, from: body, body: { ...body, received: counter, updated_at: now } }] });
    return false;
  }
  const { body: next, clearAbout } = applyMessage(body, read, now);
  /** @type {import("./journal.js").Write[]} */
  const writes = [{ kind: "contact", id: contact.id, from: body, body: { ...next, received: counter } }];
  const person = clearAbout && body.person_id ? record(body.person_id) : null;
  if (person?.body) {
    const { about: _a, about_shared_on: _s, ...rest } = person.body;
    writes.push({ kind: "person", id: person.id, from: person.body, body: { ...rest, updated_at: now } });
  }
  await save({ writes });
  if (read.type === "removed" && body.my_mailbox) await deleteMailbox(body.my_mailbox);
  return true;
}

/**
 * Checks my mailboxes now, every couple of minutes while the page is in
 * view, and on coming back to it, until signal aborts (the journal locks).
 * @param {AbortSignal} signal
 */
export function watchMailboxes(signal) {
  const check = () => { if (!signal.aborted && !document.hidden) checkMailboxes().catch(() => {}); };
  check();
  const timer = setInterval(check, CHECK_MS);
  signal.addEventListener("abort", () => clearInterval(timer));
  document.addEventListener("visibilitychange", check, { signal });
}
