// Record ids (format 2). The browser makes every id: a random UUID for a
// new record. Two kinds are worked out instead, so any device gets the same
// one:
//
// - A converted record's: from its table and the id the server gave it in
//   format 1, so a conversion that's run again writes the same records.
// - "This is me": one per account, so two devices making it at once write
//   the same record, and the second is refused as stale.
//
// Both are HMAC-SHA256 under the id key, shaped as a UUID (RFC 9562
// version 8). The id key comes from the data key (HKDF-SHA256, info
// "notonawa ids v1|<user>"), so the server, which knows the user and the
// old ids, can't work them out, and every device has it once unlocked.

const encode = (/** @type {string} */ text) => /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(text));

/** A new random record id. */
export function newId() {
  return crypto.randomUUID();
}

/**
 * The id key: HKDF-SHA256 from the data key's bytes (as an HKDF key, see
 * keys.js's idMaterial), bound to the user.
 * @param {CryptoKey} material the data key as an HKDF key
 * @param {string} userId
 * @returns {Promise<CryptoKey>} an HMAC-SHA256 key, non-extractable, for signing only
 */
export function idKeyFrom(material, userId) {
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encode(`notonawa ids v1|${userId}`) },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

/**
 * The first 16 bytes of a hash as a version 8 UUID.
 * @param {ArrayBuffer} hash
 */
export function uuidFrom(hash) {
  const b = new Uint8Array(hash.slice(0, 16));
  b[6] = (b[6] & 0x0f) | 0x80; // version 8
  b[8] = (b[8] & 0x3f) | 0x80; // the RFC 9562 variant
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * @param {CryptoKey} idKey
 * @param {string} text
 */
async function idFor(idKey, text) {
  return uuidFrom(await crypto.subtle.sign("HMAC", idKey, encode(text)));
}

/**
 * A converted record's id, the same every time for the same row.
 * @param {CryptoKey} idKey
 * @param {string} userId
 * @param {string} table the format 1 table, e.g. "ties"
 * @param {string | number} oldId
 */
export function convertedId(idKey, userId, table, oldId) {
  return idFor(idKey, `notonawa convert v1|${userId}|${table}|${oldId}`);
}

/**
 * The account's "this is me" record's id.
 * @param {CryptoKey} idKey
 * @param {string} userId
 */
export function selfId(idKey, userId) {
  return idFor(idKey, `notonawa self v1|${userId}`);
}
