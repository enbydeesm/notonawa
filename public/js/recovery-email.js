// Recovery emails. Optional; the only way the operator can check that someone
// asking to recover an account is its owner. The address never leaves the
// browser: it's scrambled here with a slow, salted hash (PBKDF2), and the
// server keeps only that hash and its salt. So a copy of the database doesn't
// list anyone's address, and testing guessed addresses against it is slow.
// Pure apart from WebCrypto, and shared with scripts/recovery-code.mjs (which
// hashes an address the same way to find its account).

export const MAX_EMAIL_LENGTH = 254;
export const EMAIL_HASH_ITERATIONS = 600_000;
const SALT_BYTES = 16;

/**
 * Makes a typed address canonical: no spaces round it, lower case (so
 * "Sam@Example.com" and "sam@example.com" hash the same). null if it doesn't
 * look like an address.
 * @param {unknown} typed
 * @returns {string | null}
 */
export function readRecoveryEmail(typed) {
  if (typeof typed !== "string") return null;
  const email = typed.normalize("NFC").trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * A new hash of an address, with a new random salt, as sent to the server.
 * @param {string} email canonical (see readRecoveryEmail)
 * @returns {Promise<{ email_hash: string, salt: string }>} both base64url
 */
export async function newRecoveryEmailHash(email) {
  const salt = toBase64Url(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
  return { email_hash: await hashRecoveryEmail(email, salt), salt };
}

/**
 * @param {string} email canonical (see readRecoveryEmail)
 * @param {string} salt base64url
 * @returns {Promise<string>} 32 bytes, base64url
 */
export async function hashRecoveryEmail(email, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(email), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(salt), iterations: EMAIL_HASH_ITERATIONS },
    key,
    256
  );
  return toBase64Url(new Uint8Array(bits));
}

/** @param {Uint8Array} bytes */
function toBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** @param {string} text */
function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
