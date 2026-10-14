// Parsing account requests. Pure, so it's easy to test.

import { BadInput } from "../http.js";

const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_16_BYTES = /^[A-Za-z0-9_-]{22}$/;

/**
 * A recovery email as the browser sends it: never the address, only its hash
 * and the salt used (see public/js/recovery-email.js).
 * @param {Record<string, unknown>} body
 * @returns {{ emailHash: string, salt: string }}
 */
export function parseRecoveryEmail(body) {
  const { email_hash: emailHash, salt } = body;
  if (typeof emailHash !== "string" || !BASE64URL_32_BYTES.test(emailHash) ||
      typeof salt !== "string" || !BASE64URL_16_BYTES.test(salt)) {
    throw new BadInput("Couldn't save that recovery email. Please try again.");
  }
  return { emailHash, salt };
}
