// Web Push: a push message encrypted to one device (RFC 8291, aes128gcm)
// and signed as ours (VAPID, RFC 8292). Pure apart from WebCrypto, so the
// Worker (src/push/send.js) and Node share it, and it's tested against the
// RFC's own example (test/unit/webpush.test.js).
//
// The push service (Apple's, Google's, Mozilla's, Microsoft's) carries the
// message to the device but can't read it: it's encrypted to the keys the
// device's browser made (p256dh, auth). VAPID tells the push service the
// message is from the server whose public key the device subscribed with,
// so no one else can push to these addresses.

const encode = (/** @type {string} */ text) => new TextEncoder().encode(text);
const RECORD_SIZE = 4096;
const TAG_BYTES = 16;
/** The most a payload can be: one record, less its delimiter and tag. */
export const MAX_PAYLOAD = RECORD_SIZE - TAG_BYTES - 1 - 86;

/** @param {ArrayBuffer | Uint8Array} data */
export function toBase64url(data) {
  let binary = "";
  for (const b of new Uint8Array(data)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function fromBase64url(text) {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

/** @param {...Uint8Array} parts */
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * HKDF-SHA-256 (extract and expand).
 * @param {Uint8Array} salt
 * @param {Uint8Array} ikm
 * @param {Uint8Array} info
 * @param {number} bytes
 */
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", /** @type {Uint8Array<ArrayBuffer>} */ (ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: /** @type {Uint8Array<ArrayBuffer>} */ (salt), info: /** @type {Uint8Array<ArrayBuffer>} */ (info) },
    key, bytes * 8,
  ));
}

/**
 * A P-256 key pair from its raw public key and private scalar, as JWK.
 * @param {Uint8Array} publicKey 65 bytes, uncompressed
 * @param {Uint8Array} d 32 bytes
 */
function privateJwk(publicKey, d) {
  return { kty: "EC", crv: "P-256", x: toBase64url(publicKey.subarray(1, 33)), y: toBase64url(publicKey.subarray(33, 65)), d: toBase64url(d), ext: true };
}

/**
 * Encrypts a payload to one device (RFC 8291 with RFC 8188's aes128gcm, one
 * record).
 * @param {Uint8Array} payload at most MAX_PAYLOAD bytes
 * @param {{ p256dh: string, auth: string }} device its keys, base64url
 * @param {{ salt?: Uint8Array, serverPublic?: Uint8Array, serverPrivate?: Uint8Array }} [fixed]
 *   for tests only: the RFC's example's salt and key pair
 * @returns {Promise<Uint8Array>} the request body
 */
export async function encryptPayload(payload, { p256dh, auth }, fixed = {}) {
  if (payload.length > MAX_PAYLOAD) throw new Error("That notification is too long to send.");
  const uaPublic = fromBase64url(p256dh);
  const authSecret = fromBase64url(auth);
  const ecdh = { name: "ECDH", namedCurve: "P-256" };

  /** @type {CryptoKey} */
  let serverKey;
  /** @type {Uint8Array} */
  let serverPublic;
  if (fixed.serverPublic && fixed.serverPrivate) {
    serverPublic = fixed.serverPublic;
    serverKey = await crypto.subtle.importKey("jwk", privateJwk(serverPublic, fixed.serverPrivate), ecdh, false, ["deriveBits"]);
  } else {
    const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(ecdh, true, ["deriveBits"]));
    serverKey = pair.privateKey;
    serverPublic = new Uint8Array(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey("raw", pair.publicKey)));
  }
  const deviceKey = await crypto.subtle.importKey("raw", uaPublic, ecdh, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    // The Workers types call it $public; the standard's (and the runtime's) name is public.
    /** @type {any} */ ({ name: "ECDH", public: deviceKey }), serverKey, 256));

  // RFC 8291 section 3.4: the input keying material, from the shared secret
  // and the device's auth secret, bound to both public keys.
  const ikm = await hkdf(authSecret, shared, concat(encode("WebPush: info\0"), uaPublic, serverPublic), 32);
  const salt = fixed.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encode("Content-Encoding: nonce\0"), 12);

  // One record: the payload, then 0x02 (the last record's delimiter).
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key,
    /** @type {Uint8Array<ArrayBuffer>} */ (concat(payload, new Uint8Array([2])))));

  // The header: salt, record size (4 bytes), key id length, key id (our public key).
  const header = new Uint8Array(21 + serverPublic.length);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = serverPublic.length;
  header.set(serverPublic, 21);
  return concat(header, sealed);
}

/**
 * The Authorization header that signs a push as ours (VAPID, RFC 8292): a
 * JWT for the push service's origin, good for 12 hours.
 * @param {{ endpoint: string, publicKey: string, privateKey: string, subject: string, now?: number }} vapid
 *   publicKey: our 65-byte P-256 public key, base64url; privateKey: its
 *   32-byte private scalar, base64url; subject: a mailto: or https: contact
 */
export async function vapidAuthorization({ endpoint, publicKey, privateKey, subject, now = Date.now() }) {
  const pub = fromBase64url(publicKey);
  const key = await crypto.subtle.importKey("jwk", privateJwk(pub, fromBase64url(privateKey)),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const part = (/** @type {object} */ value) => toBase64url(encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: subject,
  })}`;
  // WebCrypto's ECDSA signature is r ‖ s, as JWS's ES256 wants.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encode(unsigned));
  return `vapid t=${unsigned}.${toBase64url(signature)}, k=${publicKey}`;
}

/**
 * The request that sends one push.
 * @param {{ endpoint: string, p256dh: string, auth: string }} subscription
 * @param {unknown} message JSON, for the service worker (public/sw.js)
 * @param {{ topic: string, ttl: number, publicKey: string, privateKey: string, subject: string }} options
 *   topic: a newer push with the same topic replaces one still waiting
 *   (at most 32 letters, digits, - and _); ttl: seconds the push service
 *   keeps it for a device that's offline
 * @returns {Promise<{ url: string, init: RequestInit }>}
 */
export async function pushRequest(subscription, message, { topic, ttl, publicKey, privateKey, subject }) {
  const body = await encryptPayload(encode(JSON.stringify(message)), subscription);
  return {
    url: subscription.endpoint,
    init: {
      method: "POST",
      headers: {
        authorization: await vapidAuthorization({ endpoint: subscription.endpoint, publicKey, privateKey, subject }),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(ttl),
        topic,
        urgency: "normal",
      },
      body: /** @type {Uint8Array<ArrayBuffer>} */ (body),
    },
  };
}

/**
 * A new VAPID key pair (scripts/push-keys.mjs).
 * @returns {Promise<{ publicKey: string, privateKey: string }>} base64url
 */
export async function newVapidKeys() {
  const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]));
  const publicKey = toBase64url(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey("raw", pair.publicKey)));
  const { d } = /** @type {JsonWebKey} */ (await crypto.subtle.exportKey("jwk", pair.privateKey));
  return { publicKey, privateKey: /** @type {string} */ (d) };
}
