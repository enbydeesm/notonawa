// Safety numbers: 60 digits two contacts compare to check that the server
// didn't swap in a key of its own. Signal's numeric fingerprint (libsignal's
// fingerprint.rs, display form), over our X-Wing public keys and account ids:
//
//   each side: SHA-512(0x0000 ‖ key ‖ id ‖ key), then SHA-512(digest ‖ key)
//   again until 5,200 rounds; its first 30 bytes as six 5-byte big-endian
//   numbers, each mod 100,000 as 5 digits: 30 digits
//   both sides: the smaller (as text) first, so both phones show the same 60
//
// The same arithmetic as Signal's, so its published vector checks it (the
// test does). Pure apart from WebCrypto's SHA-512.

/** Rounds of SHA-512 per side, as Signal's. */
export const ITERATIONS = 5200;

const VERSION = new Uint8Array([0, 0]);

/**
 * @param {...Uint8Array} parts
 * @returns {Uint8Array<ArrayBuffer>}
 */
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
 * One side's 30 digits.
 * @param {Uint8Array} publicKey
 * @param {Uint8Array | string} id the account id (as UTF-8 if a string)
 * @param {number} [iterations]
 * @returns {Promise<string>}
 */
export async function fingerprintHalf(publicKey, id, iterations = ITERATIONS) {
  const idBytes = typeof id === "string" ? new TextEncoder().encode(id) : id;
  let digest = new Uint8Array(await crypto.subtle.digest("SHA-512", concat(VERSION, publicKey, idBytes, publicKey)));
  for (let i = 1; i < iterations; i++) {
    digest = new Uint8Array(await crypto.subtle.digest("SHA-512", concat(digest, publicKey)));
  }
  let digits = "";
  for (let chunk = 0; chunk < 6; chunk++) {
    let n = 0;
    // 40 bits: past what bitwise operators take, but well within a double.
    for (const b of digest.subarray(chunk * 5, chunk * 5 + 5)) n = n * 256 + b;
    digits += String(n % 100000).padStart(5, "0");
  }
  return digits;
}

/**
 * The 60 digits two contacts compare: the same whichever of them asks.
 * @param {{ publicKey: Uint8Array, id: Uint8Array | string }} mine
 * @param {{ publicKey: Uint8Array, id: Uint8Array | string }} theirs
 * @returns {Promise<string>}
 */
export async function safetyNumber(mine, theirs) {
  const [a, b] = await Promise.all([fingerprintHalf(mine.publicKey, mine.id), fingerprintHalf(theirs.publicKey, theirs.id)]);
  return a < b ? a + b : b + a;
}

/**
 * The number as shown: 12 blocks of 5 digits.
 * @param {string} number
 * @returns {string[]}
 */
export function safetyBlocks(number) {
  return number.match(/\d{5}/g) ?? [];
}
