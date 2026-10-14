// Making and using passkeys in the browser, with the server's options.
// Uses the browser's own JSON helpers where it has them, otherwise
// webauthn-json.js.

import {
  creationOptionsFromJSON, requestOptionsFromJSON, registrationToJSON, authenticationToJSON,
} from "./webauthn-json.js";

/** @type {any} */
const PKC = globalThis.PublicKeyCredential;

/**
 * Asks the device to make a passkey. Also asks whether it can derive
 * encryption keys (the PRF extension), which end-to-end encryption will
 * need later.
 * @param {any} options from /api/auth/register/options
 * @returns {Promise<{ response: any, prfCapable: boolean | null }>}
 */
export async function createPasskey(options) {
  const json = { ...options, extensions: { ...options.extensions, prf: {} } };
  const publicKey = PKC?.parseCreationOptionsFromJSON ? PKC.parseCreationOptionsFromJSON(json) : creationOptionsFromJSON(json);
  const credential = /** @type {any} */ (await ask(() => navigator.credentials.create({ publicKey })));
  const prf = credential.getClientExtensionResults?.().prf;
  return {
    response: typeof credential.toJSON === "function" ? credential.toJSON() : registrationToJSON(credential),
    prfCapable: typeof prf?.enabled === "boolean" ? prf.enabled : null,
  };
}

/**
 * Asks the device for one of the user's passkeys for this site.
 * @param {any} options from /api/auth/login/options
 */
export async function usePasskey(options) {
  const publicKey = PKC?.parseRequestOptionsFromJSON ? PKC.parseRequestOptionsFromJSON(options) : requestOptionsFromJSON(options);
  const credential = /** @type {any} */ (await ask(() => navigator.credentials.get({ publicKey })));
  return typeof credential.toJSON === "function" ? credential.toJSON() : authenticationToJSON(credential);
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
