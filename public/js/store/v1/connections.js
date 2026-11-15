// Connections between accounts, through today's API (format 1). They become
// contact records kept in my own sealed data later. See store/index.js.

import { api } from "../../api.js";
import { open, sealOne } from "../../vault.js";
import { convertConnections } from "../../journal-fields.js";

/**
 * My connections, newest first, their names opened.
 * @returns {Promise<import("../../connection-text.js").Connection[]>}
 */
export async function listConnections() {
  return convertConnections(await api("/api/connections"), (kind, records) => open(kind, records));
}

/**
 * Accepts an invite's offer to connect, putting it on one of my people.
 * @param {{ offer: any, personId: string, name: string, shareId: string, linkKey: string }} accept offer: the
 *   server's token (offerIn); name: the inviter's, sealed here as my side's label; the share's id and key
 *   are format 2's
 */
export async function acceptConnection({ offer, personId, name }) {
  const { label } = await sealOne("connection", { label: name });
  await api("/api/connections", { method: "POST", body: { offer, person_id: personId, label } });
}

/**
 * Puts a connection on one of my people, taking it off any other.
 * @param {string} id my side of it
 * @param {string} personId
 */
export async function setConnectionPerson(id, personId) {
  await api(`/api/connections/${encodeURIComponent(id)}/person`, { method: "PUT", body: { person_id: personId } });
}

/**
 * The inviter's Not now.
 * @param {string} id
 */
export async function markConnectionAnswered(id) {
  await api(`/api/connections/${encodeURIComponent(id)}/answered`, { method: "POST", body: {} });
}

/**
 * Removes a connection for both accounts.
 * @param {string} id my side of it
 * @param {"remove" | "keep"} about remove: clears my About from their card
 */
export async function deleteConnection(id, about) {
  await api(`/api/connections/${encodeURIComponent(id)}?about=${about}`, { method: "DELETE" });
}

/**
 * A profile invite to make: the share (share-save.js's saveShare, passed in
 * as it uses the store), whether it offers to connect, and what it shares
 * (format 2 sends the same in later updates).
 * @typedef {{ kind: "profile", data: Record<string, any>, label: string, expires: string, uses: string, connect: boolean,
 *   fields: Record<string, any>, saveShare: (share: any) => Promise<{ id: string, key: string }> }} ProfileInvite
 */

/**
 * Makes a profile invite, offering to connect if ticked (the server keeps
 * the offer).
 * @param {ProfileInvite} invite
 * @returns {Promise<{ id: string, key: string }>}
 */
export function profileInvite({ fields: _fields, saveShare, ...share }) {
  return saveShare(share);
}

/**
 * The offer to connect in a share I opened: the server's token (POST
 * /api/shares/open's offer). A format 2 invite's is in its snapshot, which
 * a format 1 account can't take.
 * @param {{ offer?: string | null, data: any }} opened
 * @returns {any}
 */
export function offerIn({ offer }) {
  return offer ?? null;
}

/**
 * An invite revoked: the server ends its offer with it.
 * @param {string} _shareId
 */
export async function inviteRevoked(_shareId) {}

/**
 * The shares that are invites offering to connect: the server says so on
 * each (its connect).
 * @returns {Set<string>}
 */
export function connectingShares() {
  return new Set();
}

/**
 * A profile update waiting from the account linked to this person: format
 * 1's connections send none.
 * @param {string} _personId
 * @returns {{ contactId: string, profile: import("../../profile-share.js").SharedProfile } | null}
 */
export function pendingProfile(_personId) {
  return null;
}

/**
 * The people with an update waiting: none on format 1.
 * @returns {Set<string>}
 */
export function peopleWithUpdates() {
  return new Set();
}

/**
 * An update reviewed: none on format 1.
 * @param {string} _contactId
 */
export async function profileUpdateDone(_contactId) {}

/**
 * A connection's verification: format 1's have no keys to check.
 * @param {string} _personId
 * @returns {{ contactId: string, verified: boolean, keyChanged: boolean } | null}
 */
export function contactStatus(_personId) {
  return null;
}

/** @returns {Set<string>} none on format 1 */
export function peopleWithChangedKeys() {
  return new Set();
}

/**
 * @param {string} _contactId
 * @returns {Promise<string | null>} none on format 1
 */
export async function contactSafetyNumber(_contactId) {
  return null;
}

/** @param {string} _contactId */
export async function markVerified(_contactId) {}

/**
 * A scanned safety number: format 1's connections have none to match.
 * @param {string} _number
 * @returns {Promise<{ contactId: string, personId: string | null, name: string | null } | null>}
 */
export async function verifyScanned(_number) {
  return null;
}

/**
 * Sharing my profile through a connection: format 1's carry no messages
 * (a profile invite's link does it).
 * @param {string} _personId
 * @param {import("../../share-back-dialog.js").ShareBack} _share
 */
export async function shareProfileWith(_personId, _share) {
  throw new Error("Share your profile with an invite link.");
}
