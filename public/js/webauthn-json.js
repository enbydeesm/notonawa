// Converting passkey options and answers between the JSON the server speaks
// and the binary the browser's WebAuthn API speaks. Only used by browsers
// without the built-in PublicKeyCredential.parse...FromJSON and toJSON
// (older Safari and Firefox). Pure, so it's easy to test.

/** @param {string} text base64url */
export function fromBase64url(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** @param {ArrayBuffer | ArrayBufferView} data */
export function toBase64url(data) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {{ id: string, type?: string, transports?: string[] }} c
 */
const credentialDescriptor = (c) => ({ ...c, type: "public-key", id: fromBase64url(c.id) });

/**
 * Server JSON -> options for navigator.credentials.create().
 * @param {any} json
 */
export function creationOptionsFromJSON(json) {
  return {
    ...json,
    challenge: fromBase64url(json.challenge),
    user: { ...json.user, id: fromBase64url(json.user.id) },
    excludeCredentials: (json.excludeCredentials ?? []).map(credentialDescriptor),
  };
}

/**
 * Server JSON -> options for navigator.credentials.get().
 * @param {any} json
 */
export function requestOptionsFromJSON(json) {
  return {
    ...json,
    challenge: fromBase64url(json.challenge),
    allowCredentials: (json.allowCredentials ?? []).map(credentialDescriptor),
  };
}

/**
 * A new passkey (from create()) -> JSON for the server.
 * @param {any} credential
 */
export function registrationToJSON(credential) {
  const r = credential.response;
  return {
    id: credential.id,
    rawId: toBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: toBase64url(r.clientDataJSON),
      attestationObject: toBase64url(r.attestationObject),
      transports: r.getTransports?.() ?? [],
    },
  };
}

/**
 * A passkey's sign-in answer (from get()) -> JSON for the server.
 * @param {any} credential
 */
export function authenticationToJSON(credential) {
  const r = credential.response;
  return {
    id: credential.id,
    rawId: toBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: toBase64url(r.clientDataJSON),
      authenticatorData: toBase64url(r.authenticatorData),
      signature: toBase64url(r.signature),
      userHandle: r.userHandle ? toBase64url(r.userHandle) : undefined,
    },
  };
}
