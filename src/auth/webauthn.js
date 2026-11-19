// Passkey (WebAuthn) checks, using @simplewebauthn/server with this app's
// settings. Every passkey must be a discoverable one (so sign-in needs no
// username) and must check it's the user (Face ID, fingerprint or PIN).

import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

const RP_NAME = "nōtonawa";

/**
 * Options for navigator.credentials.create(). userId becomes the passkey's
 * user handle, which comes back at sign-in.
 * @param {Env} env
 * @param {string} userId
 * @param {{ id: string, transports: string | null }[]} existing passkeys the authenticator shouldn't register twice
 */
export function registrationOptions(env, userId, existing) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: env.RP_ID,
    // Shown in the user's passkey list. Not stored by us.
    userName: RP_NAME,
    userID: isoBase64URL.toBuffer(isoBase64URL.fromUTF8String(userId)),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: parseTransports(p.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

/**
 * @param {Env} env
 * @param {any} response from the browser
 * @param {string} challenge the one we issued
 * @returns {Promise<{ id: string, public_key: string, counter: number, transports: string[] | undefined } | null>}
 */
export async function verifyRegistration(env, response, challenge) {
  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response, expectedChallenge: challenge, expectedOrigin: env.ORIGIN, expectedRPID: env.RP_ID,
      requireUserVerification: true,
    });
    if (!verified || !registrationInfo) return null;
    const { credential } = registrationInfo;
    return {
      id: credential.id,
      public_key: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports,
    };
  } catch {
    return null;
  }
}

/**
 * Options for navigator.credentials.get(). No list of passkeys: the browser
 * offers whichever of the user's passkeys are for this site.
 * @param {Env} env
 */
export function authenticationOptions(env) {
  return generateAuthenticationOptions({ rpID: env.RP_ID, userVerification: "required" });
}

/**
 * @param {Env} env
 * @param {any} response from the browser
 * @param {string} challenge the one we issued
 * @param {{ id: string, user_id: string, public_key: string, counter: number, transports: string | null }} passkey
 * @returns {Promise<{ counter: number } | null>}
 */
export async function verifyAuthentication(env, response, challenge, passkey) {
  // The passkey also says whose it is; it must agree with our records.
  const handle = response.response?.userHandle;
  if (handle && handle !== isoBase64URL.fromUTF8String(passkey.user_id)) return null;
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: env.ORIGIN, expectedRPID: env.RP_ID,
      credential: {
        id: passkey.id,
        publicKey: isoBase64URL.toBuffer(passkey.public_key),
        counter: passkey.counter,
        transports: parseTransports(passkey.transports),
      },
      requireUserVerification: true,
    });
    return verified ? { counter: authenticationInfo.newCounter } : null;
  } catch {
    return null;
  }
}

/** @param {string | null} stored */
function parseTransports(stored) {
  try {
    const list = stored ? JSON.parse(stored) : undefined;
    return Array.isArray(list) ? list : undefined;
  } catch {
    return undefined;
  }
}
