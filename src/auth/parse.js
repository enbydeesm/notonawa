// Parsing sign-in and account requests. Pure, so it's easy to test.

import { BadInput } from "../http.js";
import { cleanText } from "../parse.js";

// Which version of the privacy policy new accounts agree to. Change it when
// PRIVACY.md changes in a way people should agree to again.
export const TERMS_VERSION = "2026-10-12-draft";

const MAX_PASSKEY_NAME = 60;
export const INVITE_LENGTH = 16; // 10 random bytes = 80 bits
// Crockford base32: no I, L, O or U, so codes are easy to read and type.
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A new account needs a valid-looking invite, and the user's confirmation
 * that they're 18+ and consent to storing sensitive data.
 * @param {Record<string, unknown>} body
 * @returns {{ invite: string }} the invite code, normalised
 */
export function parseSignUp(body) {
  if (body.adult !== true) throw new BadInput("Rope Journal is for adults only. Please confirm you're 18 or older.");
  if (body.consent !== true) throw new BadInput("Please agree to the privacy policy to create an account.");
  const invite = normaliseCode(body.invite);
  if (!invite || invite.length !== INVITE_LENGTH) throw new BadInput("That invite code doesn't look right.");
  return { invite };
}

/**
 * Makes a typed code canonical: capitals, no spaces or dashes, and the
 * look-alike letters read as the digits they're mistaken for. null if it has
 * anything else in it. The same as normaliseCode in public/js/codes.js.
 * @param {unknown} value
 * @returns {string | null}
 */
export function normaliseCode(value) {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!code || [...code].some((c) => !BASE32.includes(c))) return null;
  return code;
}

/**
 * The login secret the browser derives from a recovery code (never the code
 * itself): 32 bytes, base64url.
 * @param {unknown} value
 * @returns {string}
 */
export function parseRecoverySecret(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new BadInput("That recovery code didn't work.");
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function parsePasskeyName(value) {
  const name = cleanText(value);
  if (!name) return "Passkey";
  if (name.length > MAX_PASSKEY_NAME) throw new BadInput(`Name the passkey in ${MAX_PASSKEY_NAME} characters or fewer.`);
  return name;
}

/**
 * Whether the passkey said it can derive encryption keys (the PRF extension).
 * null when the browser didn't say.
 * @param {unknown} value
 * @returns {0 | 1 | null}
 */
export function parsePrfCapable(value) {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

/**
 * Just enough checking to find the challenge; the WebAuthn library checks
 * everything else.
 * @param {unknown} value
 * @returns {any}
 */
export function parseCredential(value) {
  const credential = /** @type {any} */ (value);
  if (!credential || typeof credential.id !== "string" || !credential.response
      || typeof credential.response.clientDataJSON !== "string") {
    throw new BadInput("Couldn't read the passkey's answer. Please try again.");
  }
  return credential;
}

/**
 * The challenge a passkey signed, from its clientDataJSON, to look up the
 * one we issued.
 * @param {{ response: { clientDataJSON: string } }} credential
 * @returns {string}
 */
export function challengeOf(credential) {
  try {
    const base64 = credential.response.clientDataJSON.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
    const challenge = JSON.parse(json).challenge;
    if (typeof challenge === "string" && challenge) return challenge;
  } catch {
    // fall through
  }
  throw new BadInput("Couldn't read the passkey's answer. Please try again.");
}
