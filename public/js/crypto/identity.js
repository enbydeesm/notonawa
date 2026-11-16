// Identity keys: each account's X-Wing key pair (MLKEM768-X25519, HPKE KEM
// 0x647a), for sealing things to another account (a connection's
// acceptance; later, shared items' keys). Everything that touches the
// library is in this file, so native WebCrypto X-Wing can replace it
// without changing any format. Pure apart from WebCrypto and the library.
//
// HPKE suite: MLKEM768-X25519, HKDF-SHA256, AES-256-GCM, base mode, info
// "notonawa msg v1". A sealed message is the 1,120-byte encapsulated secret
// followed by the ciphertext.
//
// The private key (X-Wing's 32-byte seed) is sealed under the data key
// ("i1.<iv>.<ciphertext>"), bound to the user and to its public key's
// SHA-256, so the server can't pair the seed with a public key of its own:
//
//   notonawa|identity|v1|<user>|<SHA-256 of the public key, base64url>

import { CipherSuite, KEM_MLKEM768_X25519, KDF_HKDF_SHA256, AEAD_AES_256_GCM } from "../vendor/hpke.js";
import { toBase64url, fromBase64url } from "./keys.js";
import { CantOpen } from "./fields.js";

export const PUBLIC_KEY_BYTES = 1216;
export const SEED_BYTES = 32;
export const ENC_BYTES = 1120;
const IV_BYTES = 12;

const suite = new CipherSuite(KEM_MLKEM768_X25519, KDF_HKDF_SHA256, AEAD_AES_256_GCM);
const encode = (/** @type {string} */ text) => /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(text));
const INFO = encode("notonawa msg v1");

/**
 * @param {string} userId
 * @param {Uint8Array} publicKey
 */
export async function seedData(userId, publicKey) {
  const hash = await crypto.subtle.digest("SHA-256", /** @type {Uint8Array<ArrayBuffer>} */ (publicKey));
  return `notonawa|identity|v1|${userId}|${toBase64url(hash)}`;
}

/**
 * A new key pair.
 * @returns {Promise<{ seed: Uint8Array<ArrayBuffer>, publicKey: Uint8Array<ArrayBuffer> }>}
 */
export async function newIdentity() {
  const pair = await suite.GenerateKeyPair(true);
  const seed = /** @type {Uint8Array<ArrayBuffer>} */ (await suite.SerializePrivateKey(pair.privateKey));
  const publicKey = /** @type {Uint8Array<ArrayBuffer>} */ (await suite.SerializePublicKey(pair.publicKey));
  return { seed, publicKey };
}

/**
 * Seals the seed under the data key, bound to the user and public key.
 * @param {CryptoKey} dataKey
 * @param {{ userId: string, publicKey: Uint8Array, seed: Uint8Array<ArrayBuffer> }} identity
 * @param {{ iv?: Uint8Array<ArrayBuffer> }} [fixed] for tests only
 * @returns {Promise<string>} "i1.<iv>.<ciphertext>"
 */
export async function sealSeed(dataKey, { userId, publicKey, seed }, fixed = {}) {
  if (seed.length !== SEED_BYTES || publicKey.length !== PUBLIC_KEY_BYTES) throw new Error("Not an identity key.");
  const iv = fixed.iv ?? crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encode(await seedData(userId, publicKey)) }, dataKey, seed);
  return `i1.${toBase64url(iv)}.${toBase64url(sealed)}`;
}

/**
 * Opens the seed. Throws CantOpen if it isn't this user's, for this public key.
 * @param {CryptoKey} dataKey
 * @param {{ userId: string, publicKey: Uint8Array }} identity
 * @param {unknown} sealed
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function openSeed(dataKey, { userId, publicKey }, sealed) {
  const parts = typeof sealed === "string" ? sealed.split(".") : [];
  if (parts.length !== 3 || parts[0] !== "i1") throw new CantOpen();
  try {
    const seed = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64url(parts[1]), additionalData: encode(await seedData(userId, publicKey)) },
      dataKey, fromBase64url(parts[2]),
    ));
    if (seed.length !== SEED_BYTES) throw new CantOpen();
    return seed;
  } catch {
    throw new CantOpen();
  }
}

/**
 * Seals bytes to a public key.
 * @param {Uint8Array} publicKey the recipient's, PUBLIC_KEY_BYTES
 * @param {Uint8Array} plaintext
 * @param {string} aad what it's bound to
 * @returns {Promise<Uint8Array<ArrayBuffer>>} the encapsulated secret, then the ciphertext
 */
export async function sealTo(publicKey, plaintext, aad) {
  if (publicKey.length !== PUBLIC_KEY_BYTES) throw new Error("Not a public key.");
  const key = await suite.DeserializePublicKey(publicKey);
  const { encapsulatedSecret, ciphertext } = await suite.Seal(key, plaintext, { aad: encode(aad), info: INFO });
  const out = new Uint8Array(encapsulatedSecret.length + ciphertext.length);
  out.set(encapsulatedSecret);
  out.set(ciphertext, encapsulatedSecret.length);
  return out;
}

/**
 * Opens what sealTo sealed to my public key. Throws CantOpen if it won't.
 * @param {Uint8Array} seed my private key
 * @param {Uint8Array} sealed
 * @param {string} aad what it must be bound to
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function openWith(seed, sealed, aad) {
  if (sealed.length < ENC_BYTES + 16) throw new CantOpen();
  try {
    const key = await suite.DeserializePrivateKey(seed);
    return /** @type {Uint8Array<ArrayBuffer>} */ (await suite.Open(key, sealed.subarray(0, ENC_BYTES), sealed.subarray(ENC_BYTES), { aad: encode(aad), info: INFO }));
  } catch {
    throw new CantOpen();
  }
}
