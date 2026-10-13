// Recovery codes. The browser makes one and shows it to the user once; the
// code itself is never sent anywhere. The server gets a login secret derived
// from it (HKDF) and keeps only a hash of that. Later (step 4 in
// considerations.md) a different derivation of the code will unlock the
// user's encryption key, and the login secret can't be turned into that.
// Pure apart from WebCrypto, and shared with scripts/recovery-code.mjs.

import { newCode, normaliseCode } from "./codes.js";

export const RECOVERY_CODE_LENGTH = 32; // 20 random bytes = 160 bits

export function newRecoveryCode() {
  return newCode(20);
}

/**
 * @param {unknown} typed
 * @returns {string | null} the canonical code, or null if it can't be one
 */
export function readRecoveryCode(typed) {
  const code = normaliseCode(typed);
  return code && code.length === RECOVERY_CODE_LENGTH ? code : null;
}

/**
 * The login secret for a recovery code, as sent to the server: 32 bytes,
 * base64url.
 * @param {string} code canonical (see readRecoveryCode)
 * @returns {Promise<string>}
 */
export async function loginSecret(code) {
  const encode = (/** @type {string} */ text) => new TextEncoder().encode(text);
  const key = await crypto.subtle.importKey("raw", encode(code), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: encode("rope-journal recovery"), info: encode("login") },
    key,
    256
  );
  let binary = "";
  for (const b of new Uint8Array(bits)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
