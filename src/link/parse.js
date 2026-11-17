// Signing in on a new device with one that's signed in (migration 0034).
// Pure, so it's easy to test. The server only checks shapes: the public key
// and the sealed key are X-Wing bytes it can't use (see
// public/js/crypto/link.js).

import { BadInput } from "../http.js";

export const LINK_MINUTES = 5; // how long a request can be approved and picked up

// X-Wing's public key (1,216 bytes) and the 32-byte data key sealed to it
// (a 1,120-byte encapsulated secret, the key and a 16-byte tag), as
// base64url without padding: the same sizes as public/js/crypto/identity.js.
const PUBLIC_KEY = /^[A-Za-z0-9_-]{1622}$/;
const SEALED_KEY = /^[A-Za-z0-9_-]{1558}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, as auth/session.js's newToken

const ENDED = "This sign-in request has ended. Start again on the new device.";

/**
 * POST /api/link's body.
 * @param {Record<string, unknown>} body
 * @returns {string} the public key
 */
export function parseNewLink(body) {
  if (typeof body.public_key !== "string" || !PUBLIC_KEY.test(body.public_key)) {
    throw new BadInput("Couldn't start signing in. Reload the page and try again.");
  }
  return body.public_key;
}

/**
 * POST /api/link/status's body.
 * @param {Record<string, unknown>} body
 * @returns {{ id: string, poll: string }}
 */
export function parsePoll(body) {
  if (typeof body.id !== "string" || !UUID.test(body.id) || typeof body.poll !== "string" || !TOKEN.test(body.poll)) {
    throw new BadInput(ENDED);
  }
  return { id: body.id, poll: body.poll };
}

/**
 * POST /api/link/:id/approve's body.
 * @param {Record<string, unknown>} body
 * @returns {string} the sealed key
 */
export function parseApproval(body) {
  if (typeof body.sealed_key !== "string" || !SEALED_KEY.test(body.sealed_key)) {
    throw new BadInput("Couldn't approve it. Please try again.");
  }
  return body.sealed_key;
}

/**
 * A request id from a path, or null if it isn't one.
 * @param {string} id
 */
export function linkId(id) {
  return UUID.test(id) ? id : null;
}

export { ENDED };
