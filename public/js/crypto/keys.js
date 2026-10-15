// The encryption key and its wrapped (locked) copies. Pure apart from
// WebCrypto, so it's easy to test, and shared by the crypto Worker
// (crypto-worker.js) and, for the PRF salt only, the page.
//
// Each user has one random data key (AES-256-GCM). The server stores only
// "wraps": copies of it encrypted with a wrapping key that only the user can
// make, either from a passkey's PRF output or from the recovery code:
//
//   wrapping key = HKDF-SHA256(secret, random salt per wrap,
//                              "rope-journal wrap v1 <kind> <user id>")
//
// Each wrap is bound to its user, its own id, its kind and its version as
// AES-GCM additional data, so the server can't pass one wrap off as another
// (another user's, or a recovery wrap as a passkey's).
//
// The recovery code has 160 random bits, so HKDF (not a slow hash) is
// enough. Its login secret (recovery.js) uses another salt and info, so the
// two can't be turned into each other.

export const WRAP_VERSION = 1;

/** @typedef {"passkey" | "recovery"} WrapKind */
/**
 * A wrapped data key, as stored on the server (all base64url).
 * @typedef {{ id: string, kind: WrapKind, salt: string, iv: string, wrapped: string, version: number }} Wrap
 */

const encode = (/** @type {string} */ text) => /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(text));

/**
 * The salt every PRF request uses. Fixed for the app: sign-in doesn't know
 * who's signing in until a passkey is chosen, so it can't be per user. Each
 * passkey's PRF output is its own anyway, and the user is bound in below.
 * @returns {Promise<Uint8Array<ArrayBuffer>>} 32 bytes
 */
export async function prfSalt() {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encode("rope-journal prf v1")));
}

/**
 * The bytes a recovery code contributes to its wrapping key.
 * @param {string} code canonical (see readRecoveryCode)
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function recoveryKeyMaterial(code) {
  return encode(code);
}

/**
 * A new random data key. Extractable only so it can be wrapped once.
 * @returns {Promise<CryptoKey>}
 */
export async function newDataKey() {
  return /** @type {CryptoKey} */ (await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]));
}

/**
 * @param {WrapKind} kind
 * @param {Uint8Array<ArrayBuffer>} secret PRF output, or recoveryKeyMaterial(code)
 * @param {Uint8Array<ArrayBuffer>} salt
 * @param {string} userId
 */
async function wrappingKey(kind, secret, salt, userId) {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encode(`rope-journal wrap v1 ${kind} ${userId}`) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  );
}

/**
 * @param {string} userId
 * @param {string} wrapId
 * @param {WrapKind} kind
 * @param {number} version
 */
export function additionalData(userId, wrapId, kind, version) {
  return encode(`rope-journal|v${version}|${userId}|${wrapId}|${kind}`);
}

/**
 * Wraps the data key for a secret.
 * @param {CryptoKey} dataKey must be extractable
 * @param {{ userId: string, kind: WrapKind, secret: Uint8Array<ArrayBuffer> }} for
 * @returns {Promise<Wrap>}
 */
export async function wrapDataKey(dataKey, { userId, kind, secret }) {
  const id = crypto.randomUUID();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await wrappingKey(kind, secret, salt, userId);
  const wrapped = await crypto.subtle.wrapKey("raw", dataKey, key, {
    name: "AES-GCM", iv, additionalData: additionalData(userId, id, kind, WRAP_VERSION),
  });
  return { id, kind, salt: toBase64url(salt), iv: toBase64url(iv), wrapped: toBase64url(wrapped), version: WRAP_VERSION };
}

/**
 * Unwraps the data key. Throws WrongSecret if the secret (or anything about
 * the wrap) doesn't match.
 * @param {Wrap} wrap
 * @param {{ userId: string, secret: Uint8Array<ArrayBuffer> }} with
 * @param {{ extractable?: boolean }} [options] extractable only to wrap it again
 * @returns {Promise<CryptoKey>}
 */
export async function unwrapDataKey(wrap, { userId, secret }, { extractable = false } = {}) {
  if (wrap.version !== WRAP_VERSION) throw new WrongSecret();
  try {
    const key = await wrappingKey(wrap.kind, secret, fromBase64url(wrap.salt), userId);
    return await crypto.subtle.unwrapKey(
      "raw", fromBase64url(wrap.wrapped), key,
      { name: "AES-GCM", iv: fromBase64url(wrap.iv), additionalData: additionalData(userId, wrap.id, wrap.kind, wrap.version) },
      { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]
    );
  } catch {
    throw new WrongSecret();
  }
}

/** The secret doesn't unlock this wrap. */
export class WrongSecret extends Error {
  constructor() {
    super("That doesn't unlock your journal.");
    this.name = "WrongSecret";
  }
}

/** @param {ArrayBuffer | Uint8Array} data */
export function toBase64url(data) {
  let binary = "";
  for (const b of new Uint8Array(data)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function fromBase64url(text) {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
