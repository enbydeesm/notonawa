// Codes people type: recovery codes and invite codes. Crockford base32 (no
// I, L, O or U) in groups of 4, so they're easy to read out and type. Pure,
// and shared by the pages and scripts/. src/auth/parse.js has its own copy of
// normaliseCode for the Worker; keep the two the same.

const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A new random code, e.g. 10 bytes -> "7K2M-9QXA-…" (16 characters).
 * @param {number} bytes a multiple of 5
 */
export function newCode(bytes) {
  return formatCode(base32(crypto.getRandomValues(new Uint8Array(bytes))));
}

/**
 * @param {Uint8Array} bytes
 */
export function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** @param {string} code canonical, e.g. "7K2M9QXA" -> "7K2M-9QXA" */
export function formatCode(code) {
  return code.match(/.{1,4}/g)?.join("-") ?? "";
}

/**
 * Makes a typed code canonical: capitals, no spaces or dashes, and the
 * look-alike letters read as the digits they're mistaken for. null if it has
 * anything else in it.
 * @param {unknown} value
 * @returns {string | null}
 */
export function normaliseCode(value) {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!code || [...code].some((c) => !BASE32.includes(c))) return null;
  return code;
}
