// Signing in on a new device with one that's signed in (src/link/): what
// both devices agree on. Pure apart from WebCrypto and identity.js's X-Wing.
//
// The new device's crypto Worker makes a throwaway X-Wing key pair; the
// server keeps the public key. The QR code the new device shows is
//
//   /link#<request id>.<SHA-256 of the public key, base64url>
//
// so the approving device can check the key the server gives it is the one
// on the new device's screen: the server can't swap in its own. The
// approving device seals the 32-byte data key to it with HPKE
// (identity.js's sealTo), bound to the account and the request:
//
//   notonawa|link|v1|<user id>|<request id>
//
// The 2-digit number, from the same hash, is shown on the new device and
// picked from three on the approving one, so it can't be approved without
// looking at the new device: someone who sends a code to scan ("to verify
// your account") would have to say the number too.

import { sealTo, openWith, PUBLIC_KEY_BYTES } from "./identity.js";
import { toBase64url, fromBase64url } from "./keys.js";
import { CantOpen } from "./fields.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[A-Za-z0-9_-]{43}$/; // 32 bytes
export const DATA_KEY_BYTES = 32;

/**
 * What the sealed key is bound to.
 * @param {string} userId
 * @param {string} requestId
 */
export function linkBinding(userId, requestId) {
  return `notonawa|link|v1|${userId}|${requestId}`;
}

/**
 * The public key's SHA-256, base64url: what the QR code carries.
 * @param {Uint8Array} publicKey
 * @returns {Promise<string>}
 */
export async function keyHash(publicKey) {
  return toBase64url(await crypto.subtle.digest("SHA-256", /** @type {Uint8Array<ArrayBuffer>} */ (publicKey)));
}

/**
 * The number both devices show, 10–99, from the key's hash.
 * @param {string} hash keyHash's
 */
export function linkNumber(hash) {
  const bytes = fromBase64url(hash);
  return ((bytes[0] << 8) | bytes[1]) % 90 + 10;
}

/**
 * Three numbers to pick from: the right one and two others, in a random
 * order.
 * @param {number} right
 * @param {() => number} [random] 0 to 1, for tests
 * @returns {number[]}
 */
export function numberChoices(right, random = Math.random) {
  const choices = [right];
  while (choices.length < 3) {
    const other = 10 + Math.floor(random() * 90);
    if (!choices.includes(other)) choices.push(other);
  }
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}

/**
 * The link the QR code holds.
 * @param {string} origin e.g. https://notonawa.app
 * @param {string} requestId
 * @param {string} hash keyHash's
 */
export function linkAddress(origin, requestId, hash) {
  return `${origin}/link#${requestId}.${hash}`;
}

/**
 * Reads "#<request id>.<key hash>", or null if it isn't one.
 * @param {string} fragment location.hash
 * @returns {{ id: string, keyHash: string } | null}
 */
export function readLinkFragment(fragment) {
  const [id, hash, ...rest] = fragment.replace(/^#/, "").split(".");
  if (rest.length || !UUID.test(id ?? "") || !HASH.test(hash ?? "")) return null;
  return { id, keyHash: hash };
}

/**
 * Seals the data key's bytes to the new device's public key.
 * @param {Uint8Array} rawKey DATA_KEY_BYTES
 * @param {Uint8Array} publicKey
 * @param {string} binding linkBinding's
 * @returns {Promise<string>} base64url
 */
export async function sealLinkKey(rawKey, publicKey, binding) {
  if (rawKey.length !== DATA_KEY_BYTES || publicKey.length !== PUBLIC_KEY_BYTES) throw new Error("Not a data key or a public key.");
  return toBase64url(await sealTo(publicKey, rawKey, binding));
}

/**
 * Opens what sealLinkKey sealed. Throws CantOpen if it won't, or isn't a
 * data key.
 * @param {Uint8Array} seed the new device's throwaway private key
 * @param {string} sealed base64url
 * @param {string} binding linkBinding's
 * @returns {Promise<Uint8Array<ArrayBuffer>>} the data key's bytes
 */
export async function openLinkKey(seed, sealed, binding) {
  const raw = await openWith(seed, fromBase64url(sealed), binding);
  if (raw.length !== DATA_KEY_BYTES) {
    raw.fill(0);
    throw new CantOpen();
  }
  return raw;
}
