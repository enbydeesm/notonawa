// Making and using passkeys in the browser, with the server's options.
// Uses the browser's own JSON helpers where it has them, otherwise
// webauthn-json.js.
//
// Every passkey request also asks for PRF output (the WebAuthn "PRF"
// extension): a secret only that passkey can produce, which unlocks the
// journal's encryption key (crypto/keys.js). It's returned separately, as
// bytes for the crypto Worker, and taken out of everything sent to the
// server (withoutPrfResults).

import {
  creationOptionsFromJSON, requestOptionsFromJSON, registrationToJSON, authenticationToJSON, withoutPrfResults,
  fromBase64url,
} from "./webauthn-json.js";
import { prfSalt } from "./crypto/keys.js";

/** @type {any} */
const PKC = globalThis.PublicKeyCredential;

/**
 * Asks the device to make a passkey, and for its PRF output where the
 * device can give it at creation (some only give it at sign-in: then
 * prfOutput is null and prfOutputFor() can ask for it).
 * @param {any} options from /api/auth/register/options
 * @returns {Promise<{ response: any, credentialId: string, prfCapable: boolean | null, prfOutput: ArrayBuffer | null }>}
 */
export async function createPasskey(options) {
  const publicKey = PKC?.parseCreationOptionsFromJSON ? PKC.parseCreationOptionsFromJSON(options) : creationOptionsFromJSON(options);
  const withPrf = { ...publicKey, extensions: { ...publicKey.extensions, prf: { eval: { first: await prfSalt() } } } };
  let credential;
  try {
    credential = /** @type {any} */ (await ask(() => navigator.credentials.create({ publicKey: withPrf })));
  } catch (err) {
    // A browser that can't evaluate PRF at creation may refuse the request
    // outright (before asking the user): ask again, only whether it can.
    if (!(err instanceof DOMException && err.name === "NotSupportedError")) throw err;
    const plain = { ...publicKey, extensions: { ...publicKey.extensions, prf: {} } };
    credential = /** @type {any} */ (await ask(() => navigator.credentials.create({ publicKey: plain })));
  }
  const prf = credential.getClientExtensionResults?.().prf;
  const prfOutput = prf?.results?.first ?? null;
  return {
    response: withoutPrfResults(typeof credential.toJSON === "function" ? credential.toJSON() : registrationToJSON(credential)),
    credentialId: credential.id,
    prfCapable: prfOutput ? true : typeof prf?.enabled === "boolean" ? prf.enabled : null,
    prfOutput: prfOutput ? copyBuffer(prfOutput) : null,
  };
}

/**
 * Asks the device for one of the user's passkeys for this site, and its PRF
 * output (null if it can't give it).
 * @param {any} options from /api/auth/login/options
 * @returns {Promise<{ response: any, prfOutput: ArrayBuffer | null }>}
 */
export async function usePasskey(options) {
  const parsed = PKC?.parseRequestOptionsFromJSON ? PKC.parseRequestOptionsFromJSON(options) : requestOptionsFromJSON(options);
  const publicKey = { ...parsed, extensions: { ...parsed.extensions, prf: { eval: { first: await prfSalt() } } } };
  const credential = /** @type {any} */ (await ask(() => navigator.credentials.get({ publicKey })));
  const prfOutput = credential.getClientExtensionResults?.().prf?.results?.first ?? null;
  return {
    response: withoutPrfResults(typeof credential.toJSON === "function" ? credential.toJSON() : authenticationToJSON(credential)),
    prfOutput: prfOutput ? copyBuffer(prfOutput) : null,
  };
}

/**
 * The PRF output of one particular passkey, for wrapping the key for it
 * (e.g. one just made, whose device didn't give it at creation).
 *
 * NOT A SIGN-IN, and never to be used as one: the challenge is made here,
 * the server never sees or checks the answer, and nothing about it proves
 * who the user is. It must never start or freshen a session, or stand in
 * for "confirm it's you". Its only use is the PRF output, which only
 * unlocks anything once the crypto Worker has checked it against a wrap.
 * @param {string} credentialId base64url
 * @returns {Promise<ArrayBuffer | null>} null if the passkey can't give it
 */
export async function prfOutputFor(credentialId) {
  const publicKey = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [{ type: "public-key", id: fromBase64url(credentialId) }],
    userVerification: "required",
    extensions: { prf: { eval: { first: await prfSalt() } } },
  };
  const credential = /** @type {any} */ (await ask(() => navigator.credentials.get({ publicKey: /** @type {any} */ (publicKey) })));
  const prfOutput = credential.getClientExtensionResults?.().prf?.results?.first ?? null;
  return prfOutput ? copyBuffer(prfOutput) : null;
}

/**
 * PRF output moved into a buffer of its own, which can be handed
 * (transferred) to the crypto Worker, leaving nothing readable here. The
 * browser's copy is zeroed.
 * @param {ArrayBuffer | ArrayBufferView} data
 */
function copyBuffer(data) {
  const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const copy = view.slice().buffer;
  view.fill(0);
  return copy;
}

/**
 * Runs a WebAuthn call, turning its errors into messages people understand.
 * @param {() => Promise<Credential | null>} call
 */
async function ask(call) {
  if (!PKC || !navigator.credentials) throw new Error("This browser doesn't support passkeys.");
  try {
    const credential = await call();
    if (!credential) throw new Error("No passkey was chosen.");
    return credential;
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "AbortError") throw new Error("Cancelled, or it took too long. Try again when you're ready.", { cause: err });
    if (name === "InvalidStateError") throw new Error("This device already has a passkey for your account.", { cause: err });
    throw err;
  }
}

/**
 * Tells the browser (or password manager) that these passkeys no longer work
 * here, so it can stop offering them. Only some browsers can (the WebAuthn
 * Signal API); elsewhere the passkeys stay listed until the user removes
 * them. The site's hostname is its RP_ID (see wrangler.jsonc).
 * @param {string[]} credentialIds base64url
 */
export async function forgetPasskeys(credentialIds) {
  if (typeof PKC?.signalUnknownCredential !== "function") return;
  for (const credentialId of credentialIds) {
    try {
      await PKC.signalUnknownCredential({ rpId: location.hostname, credentialId });
    } catch {
      // Best effort: the account is already deleted either way.
    }
  }
}
