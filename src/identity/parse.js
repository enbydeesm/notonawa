// Identity keys (format 2): each account's X-Wing public key, stored plain
// so others can seal to it, and its seed, sealed under the data key on the
// device ("i1.…"). Pure, so it's easy to test.

import { BadInput } from "../http.js";

// 1,216 bytes in base64url (no padding).
const PUBLIC_KEY = /^[A-Za-z0-9_-]{1622}$/;
// "i1.", a 12-byte IV, ".", the sealed 32-byte seed with its tag (48 bytes).
const SEALED_SEED = /^i1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$/;

/**
 * PUT /api/identity's body.
 * @param {any} body
 * @returns {{ publicKey: string, sealedSeed: string }}
 */
export function parseIdentity(body) {
  if (typeof body?.public_key !== "string" || !PUBLIC_KEY.test(body.public_key)) throw new BadInput("That isn't a public key.");
  if (typeof body?.sealed_seed !== "string" || !SEALED_SEED.test(body.sealed_seed)) {
    throw new BadInput("Couldn't save your identity key: it wasn't sealed. Reload the page and try again.");
  }
  return { publicKey: body.public_key, sealedSeed: body.sealed_seed };
}
