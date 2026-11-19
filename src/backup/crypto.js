// Sealing the daily backups so only the holder of the backup private key can
// open them: not the Worker that makes them, and not anyone who gets into
// Cloudflare. Each backup gets a fresh AES-256-GCM key, which is locked with
// the backup public key (RSA-OAEP, SHA-256) and stored in front of it.
// WebCrypto only, so the Worker and the scripts (Node) share it.
//
// File: "NNB1" | locked key's length (uint16, big-endian) | locked key |
// IV (12 bytes) | ciphertext with its tag. Everything before the
// ciphertext is authenticated too.

const MAGIC = new TextEncoder().encode("NNB1");
export const RSA = { name: "RSA-OAEP", hash: "SHA-256" };

/**
 * A new backup key pair (scripts/backup-keys.mjs).
 * @returns {Promise<CryptoKeyPair>}
 */
export function newBackupKeys() {
  return /** @type {Promise<CryptoKeyPair>} */ (crypto.subtle.generateKey(
    { ...RSA, modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["encrypt", "decrypt"]
  ));
}

/**
 * @param {string} jwkText the public key, as JSON (wrangler.jsonc's BACKUP_PUBLIC_KEY)
 */
export async function importPublicKey(jwkText) {
  const jwk = JSON.parse(jwkText);
  if (jwk.kty !== "RSA" || jwk.d) throw new Error("BACKUP_PUBLIC_KEY should be the public key only.");
  return crypto.subtle.importKey("jwk", jwk, RSA, false, ["encrypt"]);
}

/**
 * @param {Uint8Array} plaintext
 * @param {CryptoKey} publicKey
 * @returns {Promise<Uint8Array>}
 */
export async function sealBackup(plaintext, publicKey) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const locked = new Uint8Array(await crypto.subtle.encrypt(RSA, publicKey, raw));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = new Uint8Array(MAGIC.length + 2 + locked.length + iv.length);
  header.set(MAGIC, 0);
  new DataView(header.buffer).setUint16(MAGIC.length, locked.length);
  header.set(locked, MAGIC.length + 2);
  header.set(iv, MAGIC.length + 2 + locked.length);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: header }, key, plaintext));
  const out = new Uint8Array(header.length + ciphertext.length);
  out.set(header, 0);
  out.set(ciphertext, header.length);
  return out;
}

/**
 * @param {Uint8Array} file
 * @param {CryptoKey} privateKey
 * @returns {Promise<Uint8Array>}
 */
export async function openBackup(file, privateKey) {
  file = new Uint8Array(file);
  if (file.length < MAGIC.length + 2 || !MAGIC.every((b, i) => file[i] === b)) throw new Error("This isn't a nōtonawa daily backup.");
  const lockedLength = new DataView(file.buffer).getUint16(MAGIC.length);
  const headerLength = MAGIC.length + 2 + lockedLength + 12;
  if (file.length < headerLength + 16) throw new Error("Couldn't open it: the file is damaged.");
  const header = file.slice(0, headerLength);
  const locked = header.slice(MAGIC.length + 2, MAGIC.length + 2 + lockedLength);
  const iv = header.slice(headerLength - 12);
  try {
    const raw = await crypto.subtle.decrypt(RSA, privateKey, locked);
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: header }, key, file.slice(headerLength)));
  } catch {
    throw new Error("Couldn't open it: wrong key, or the file is damaged.");
  }
}
