// A software passkey for API tests: makes real WebAuthn responses (ES256
// keys from WebCrypto, CBOR-encoded), so the Worker's checks run for real.
// Like a phone's passkey: discoverable, and it always verifies the user.

import { base64url } from "../src/auth/session.js";

/**
 * @param {{ origin?: string, rpId?: string }} [options]
 */
export async function newFakePasskey({ origin = "http://localhost", rpId = "localhost" } = {}) {
  const keys = /** @type {CryptoKeyPair} */ (
    await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])
  );
  const rawId = crypto.getRandomValues(new Uint8Array(16));
  const id = base64url(rawId);
  const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(rpId)));
  let counter = 0;
  /** @type {string | null} */
  let userHandle = null;

  return {
    id,
    /** The user handle it was registered with (base64url), or null. */
    get userHandle() { return userHandle; },

    /**
     * Answers navigator.credentials.create() options.
     * @param {any} options from /api/auth/register/options
     * @param {{ origin?: string, challenge?: string }} [overrides]
     */
    async register(options, overrides = {}) {
      userHandle = options.user.id;
      const clientDataJSON = utf8(JSON.stringify({
        type: "webauthn.create", challenge: overrides.challenge ?? options.challenge,
        origin: overrides.origin ?? origin, crossOrigin: false,
      }));
      const publicKey = new Uint8Array(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey("raw", keys.publicKey)));
      // EC2 key, ES256, curve P-256, then x and y.
      const coseKey = map([[1, 2], [3, -7], [-1, 1], [-2, publicKey.slice(1, 33)], [-3, publicKey.slice(33)]]);
      const authData = concat(
        rpIdHash,
        Uint8Array.of(0x45), // user present, user verified, credential included
        uint32(counter),
        new Uint8Array(16), // AAGUID: unknown
        Uint8Array.of(rawId.length >> 8, rawId.length & 255),
        rawId,
        cbor(coseKey)
      );
      const attestationObject = cbor(map([["fmt", "none"], ["attStmt", map([])], ["authData", authData]]));
      return {
        id, rawId: id, type: "public-key", authenticatorAttachment: "platform", clientExtensionResults: {},
        response: {
          clientDataJSON: base64url(clientDataJSON),
          attestationObject: base64url(attestationObject),
          transports: ["internal"],
        },
      };
    },

    /**
     * Answers navigator.credentials.get() options.
     * @param {any} options from /api/auth/login/options
     * @param {{ origin?: string, userHandle?: string }} [overrides]
     */
    async authenticate(options, overrides = {}) {
      counter++;
      const clientDataJSON = utf8(JSON.stringify({
        type: "webauthn.get", challenge: options.challenge, origin: overrides.origin ?? origin, crossOrigin: false,
      }));
      const authData = concat(rpIdHash, Uint8Array.of(0x05), uint32(counter)); // present and verified
      const signed = concat(authData, new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON)));
      const signature = new Uint8Array(
        await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, signed)
      );
      return {
        id, rawId: id, type: "public-key", authenticatorAttachment: "platform", clientExtensionResults: {},
        response: {
          clientDataJSON: base64url(clientDataJSON),
          authenticatorData: base64url(authData),
          signature: base64url(derSignature(signature)),
          userHandle: overrides.userHandle ?? userHandle,
        },
      };
    },
  };
}

/**
 * A CBOR map, keeping its keys in order.
 * @param {[unknown, unknown][]} entries
 */
function map(entries) {
  return new Map(entries);
}

/** @param {string} text */
function utf8(text) {
  return new TextEncoder().encode(text);
}

/** @param {number} n */
function uint32(n) {
  return Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

/** @param {...Uint8Array} parts */
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Just enough CBOR for WebAuthn: integers, byte strings, text and maps.
 * @param {unknown} value
 * @returns {Uint8Array}
 */
function cbor(value) {
  /** @param {number} major @param {number} n */
  const head = (major, n) => {
    const m = major << 5;
    if (n < 24) return Uint8Array.of(m | n);
    if (n < 256) return Uint8Array.of(m | 24, n);
    if (n < 65536) return Uint8Array.of(m | 25, n >> 8, n & 255);
    return Uint8Array.of(m | 26, ...uint32(n));
  };
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  if (typeof value === "string") {
    const bytes = utf8(value);
    return concat(head(3, bytes.length), bytes);
  }
  if (value instanceof Map) {
    return concat(head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)]));
  }
  throw new Error(`cbor: can't encode ${typeof value}`);
}

/**
 * WebCrypto signs ECDSA as r || s; WebAuthn wants it DER-encoded.
 * @param {Uint8Array} raw 64 bytes
 */
function derSignature(raw) {
  /** @param {Uint8Array} n */
  const integer = (n) => {
    let i = 0;
    while (i < n.length - 1 && n[i] === 0) i++;
    const trimmed = n.slice(i);
    const body = trimmed[0] & 0x80 ? concat(Uint8Array.of(0), trimmed) : trimmed;
    return concat(Uint8Array.of(0x02, body.length), body);
  };
  const seq = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(Uint8Array.of(0x30, seq.length), seq);
}
