// Signing in on a new device with one that's signed in, as Signal links a
// device (src/link/; crypto/link.js has the formats).
//
// The new device: startLink makes a throwaway key pair in the crypto Worker
// and a request on the server, and gives the QR code's link and the number
// to show; checkLink asks whether it's been approved (every few seconds);
// once it has, this device holds a session that can only add a passkey,
// and finishLink adds one, with the key wrapped for it, and unlocks.
//
// The approving device: linkRequest fetches the request's public key and
// checks it against the QR code; approveLink asks for the passkey (proof,
// as adding a passkey does) and sends the data key sealed to that key.

import { api } from "./api.js";
import { proveIt } from "./key-flows.js";
import { createPasskey, prfOutputFor } from "./webauthn.js";
import { keyHash, linkAddress, linkNumber } from "./crypto/link.js";
import { fromBase64url } from "./crypto/keys.js";
import * as vault from "./vault.js";

/**
 * @typedef {{ id: string, poll: string, link: string, number: number, expiresAt: string }} NewLink
 * @typedef {{ state: "waiting" } | { state: "approved", user_id: string, sealed_key: string }} LinkStatus
 */

/**
 * The new device: starts a request.
 * @returns {Promise<NewLink>}
 */
export async function startLink() {
  const { publicKey, keyHash: hash } = await vault.linkStart();
  const made = await api("/api/link", { method: "POST", body: { public_key: publicKey } });
  return { id: made.id, poll: made.poll, link: linkAddress(location.origin, made.id, hash), number: linkNumber(hash), expiresAt: made.expires_at };
}

/**
 * Whether it's been approved. Once it has, this device is signed in (only
 * to add a passkey) and the Worker has the key: finishLink next. Throws an
 * ApiError (404) once it has ended or been declined.
 * @param {NewLink} link
 * @returns {Promise<boolean>}
 */
export async function checkLink(link) {
  /** @type {LinkStatus} */
  const status = await api("/api/link/status", { method: "POST", body: { id: link.id, poll: link.poll } });
  if (status.state !== "approved") return false;
  try {
    await vault.linkOpen({ userId: status.user_id, requestId: link.id, sealed: status.sealed_key });
  } catch (err) {
    if (!(err instanceof vault.CantOpen)) throw err;
    throw new Error("Couldn't open what your other device sent. Go back and start again.", { cause: err });
  }
  return true;
}

/**
 * The new device, approved: adds a passkey, with the key wrapped for it if
 * it gives PRF output, which makes the session a full one, and unlocks.
 * @param {string} name for the new passkey
 * @returns {Promise<{ canUnlock: boolean }>} canUnlock: whether this
 *   passkey unlocks next time (otherwise the recovery code does)
 */
export async function finishLink(name) {
  const options = await api("/api/auth/register/options", { method: "POST", body: {} });
  const made = await createPasskey(options);
  const prf = made.prfOutput ?? await prfOutputFor(made.credentialId).catch(() => null);
  const { wrap } = await vault.linkTake({ prf });
  try {
    await api("/api/auth/register/verify", {
      method: "POST", body: { response: made.response, name, prf_capable: prf ? true : made.prfCapable, passkey_wrap: wrap },
    });
  } catch (err) {
    vault.lock();
    throw err;
  }
  return { canUnlock: wrap !== null };
}

/**
 * The approving device: the request a scanned link is for, checked against
 * the key hash the link carries. Throws if it has ended, or if the server's
 * key isn't the one on the new device's screen.
 * @param {{ id: string, keyHash: string }} scanned
 * @returns {Promise<{ id: string, publicKey: string, keyHash: string, number: number }>}
 */
export async function linkRequest(scanned) {
  const found = await api(`/api/link/${encodeURIComponent(scanned.id)}`);
  if (await keyHash(fromBase64url(found.public_key)) !== scanned.keyHash) throw new LinkMismatch();
  return { id: scanned.id, publicKey: found.public_key, keyHash: scanned.keyHash, number: linkNumber(scanned.keyHash) };
}

/**
 * Approves it: asks for the passkey (or the recovery code, if that passkey
 * can't unlock), and sends the data key sealed to the new device's key.
 * @param {{ id: string, publicKey: string, keyHash: string }} request
 */
export async function approveLink(request) {
  const { keys, proof } = await proveIt();
  const sealed = await vault.linkSeal({ userId: keys.user_id, requestId: request.id, publicKey: request.publicKey, keyHash: request.keyHash, proof });
  await api(`/api/link/${encodeURIComponent(request.id)}/approve`, { method: "POST", body: { sealed_key: sealed } });
}

/**
 * Declines it, so the new device stops waiting. Errors are ignored: it ends
 * by itself within 5 minutes anyway.
 * @param {string} id
 */
export async function declineLink(id) {
  await api(`/api/link/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
}

/** The server gave a key that isn't the one the QR code is for. */
export class LinkMismatch extends Error {
  constructor() {
    super("This code doesn't match what the server sent, so it can't be approved safely. Don't approve it.");
    this.name = "LinkMismatch";
  }
}
