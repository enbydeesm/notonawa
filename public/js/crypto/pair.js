// What two connected accounts send each other. Pure apart from WebCrypto
// and identity.js.
//
// The acceptance: accepting a profile invite sends the inviter my public
// key, mailbox and its token, a new pair key, and my profile if I share
// one, HPKE-sealed to the inviter's public key (which came inside the
// invite's snapshot, sealed with the link's key) and bound to the share:
//
//   notonawa|accept|v1|<share id>
//
// Inside, it carries an HMAC-SHA256 under a key from the link's key (HKDF,
// info "notonawa accept v1 <share id>"), so only someone who had the link
// could have sent it: the server, which has the inviter's public key, can't
// make one of its own.
//
// Every later message is sealed with the pair key (AES-256-GCM), which only
// the two of us have, so it's known to come from the contact even though
// the server sees the mailbox's write token. "m1.<counter>.<iv>.<ciphertext>",
// bound to the mailbox and the counter:
//
//   notonawa|msg|v1|<mailbox id>|<counter>
//
// The counter starts at 1 and rises with each message to that mailbox; the
// recipient keeps the last it took and refuses any not above it, so an old
// message can't be played again.

import { toBase64url, fromBase64url } from "./keys.js";
import { CantOpen } from "./fields.js";
import { sealTo, openWith } from "./identity.js";

const IV_BYTES = 12;
const KEY_BYTES = 32;
const encode = (/** @type {string} */ text) => /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(text));
const decode = (/** @type {BufferSource} */ bytes) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);

/** @param {string} shareId */
export const acceptanceData = (shareId) => `notonawa|accept|v1|${shareId}`;

/**
 * @param {string} mailboxId
 * @param {number} counter
 */
export const messageData = (mailboxId, counter) => `notonawa|msg|v1|${mailboxId}|${counter}`;

/**
 * The acceptance's HMAC key, from the link's key.
 * @param {Uint8Array<ArrayBuffer>} linkKey
 * @param {string} shareId
 * @param {"sign" | "verify"} use
 */
async function macKey(linkKey, shareId, use) {
  const material = await crypto.subtle.importKey("raw", linkKey, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encode(`notonawa accept v1 ${shareId}`) },
    material, { name: "HMAC", hash: "SHA-256", length: 256 }, false, [use],
  );
}

/**
 * Seals an acceptance to the inviter.
 * @param {{ inviterPublicKey: Uint8Array, shareId: string, linkKey: Uint8Array<ArrayBuffer>, payload: unknown }} acceptance
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function sealAcceptance({ inviterPublicKey, shareId, linkKey, payload }) {
  const body = JSON.stringify({ share: shareId, payload });
  const mac = await crypto.subtle.sign("HMAC", await macKey(linkKey, shareId, "sign"), encode(body));
  return sealTo(inviterPublicKey, encode(JSON.stringify({ body, mac: toBase64url(mac) })), acceptanceData(shareId));
}

/**
 * Opens an acceptance of my invite. Throws CantOpen unless it's sealed to
 * me, for this share, by someone with its link.
 * @param {{ seed: Uint8Array, shareId: string, linkKey: Uint8Array<ArrayBuffer>, sealed: Uint8Array }} acceptance
 * @returns {Promise<unknown>} the payload
 */
export async function openAcceptance({ seed, shareId, linkKey, sealed }) {
  const outer = await openWith(seed, sealed, acceptanceData(shareId));
  try {
    const { body, mac } = JSON.parse(decode(outer));
    if (typeof body !== "string" || typeof mac !== "string") throw new CantOpen();
    const ok = await crypto.subtle.verify("HMAC", await macKey(linkKey, shareId, "verify"), fromBase64url(mac), encode(body));
    const inner = JSON.parse(body);
    if (!ok || inner.share !== shareId) throw new CantOpen();
    return inner.payload;
  } catch {
    throw new CantOpen();
  }
}

/**
 * A new pair key, as kept in both contacts' records.
 * @returns {string} base64url, 32 bytes
 */
export function newPairKey() {
  const raw = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const text = toBase64url(raw);
  raw.fill(0);
  return text;
}

/** @param {unknown} text */
async function pairKey(text) {
  /** @type {Uint8Array<ArrayBuffer>} */
  let raw;
  try {
    raw = fromBase64url(/** @type {string} */ (text));
  } catch {
    throw new CantOpen();
  }
  if (typeof text !== "string" || raw.length !== KEY_BYTES) throw new CantOpen();
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  raw.fill(0);
  return key;
}

/**
 * Seals a message to a contact's mailbox.
 * @param {string} key the pair key
 * @param {{ mailboxId: string, counter: number }} where counter: 1 more than the last sent there
 * @param {unknown} payload
 * @param {{ iv?: Uint8Array<ArrayBuffer> }} [fixed] for tests only
 * @returns {Promise<string>} "m1.<counter>.<iv>.<ciphertext>"
 */
export async function sealMessage(key, { mailboxId, counter }, payload, fixed = {}) {
  if (!mailboxId || !Number.isSafeInteger(counter) || counter < 1) throw new Error("A message needs its mailbox and a counter from 1.");
  const iv = fixed.iv ?? crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encode(messageData(mailboxId, counter)) },
    await pairKey(key), encode(JSON.stringify(payload)),
  );
  return `m1.${counter}.${toBase64url(iv)}.${toBase64url(sealed)}`;
}

/**
 * Opens a message from my mailbox. Throws CantOpen if it isn't from my
 * contact, for this mailbox, at the counter it says. Whether that counter
 * is new is acceptCounter's.
 * @param {string} key the pair key
 * @param {string} mailboxId
 * @param {unknown} sealed
 * @returns {Promise<{ counter: number, payload: unknown }>}
 */
export async function openMessage(key, mailboxId, sealed) {
  const parts = typeof sealed === "string" ? sealed.split(".") : [];
  const counter = Number(parts[1]);
  if (parts.length !== 4 || parts[0] !== "m1" || !/^[1-9]\d*$/.test(parts[1]) || !Number.isSafeInteger(counter)) throw new CantOpen();
  const aesKey = await pairKey(key);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64url(parts[2]), additionalData: encode(messageData(mailboxId, counter)) },
      aesKey, fromBase64url(parts[3]),
    );
    return { counter, payload: JSON.parse(decode(plain)) };
  } catch {
    throw new CantOpen();
  }
}

/**
 * Whether a message's counter is new: above the last one taken from that
 * mailbox (0 before any).
 * @param {number} lastTaken
 * @param {number} counter
 */
export function acceptCounter(lastTaken, counter) {
  return Number.isSafeInteger(counter) && counter > lastTaken;
}
