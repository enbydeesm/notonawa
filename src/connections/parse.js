// Connections between accounts: request parsing and offer tokens. Pure, so
// it's easy to test. See considerations.md, "Sharing between accounts":
// "Connecting accounts".

import { BadInput } from "../http.js";
import { cleanText, encryptedText } from "../parse.js";
import { newToken } from "../auth/session.js";

/** How long an offer to connect lasts after the invite is opened (SQLite modifier). */
export const OFFER_LIFETIME = "+1 day";
/** A sealed label (a name is short; sealing adds a third and more). */
export const MAX_SEALED_LABEL = 1000;

// 32 random bytes, base64url (newToken).
const OFFER_TOKEN = /^[A-Za-z0-9_-]{43}$/;
// crypto.randomUUID().
const CONNECTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A new offer's token: given to whoever opened the invite; only its hash is kept. */
export const newOfferToken = newToken;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function parseOfferToken(value) {
  if (typeof value !== "string" || !OFFER_TOKEN.test(value)) throw new BadInput("This offer to connect has ended.");
  return value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function parseConnectionId(value) {
  if (typeof value !== "string" || !CONNECTION_ID.test(value)) throw new BadInput("That isn't a connection.");
  return value;
}

/**
 * The person a connection goes on: one of mine (checked by the database).
 * @param {unknown} value
 * @returns {string}
 */
export function parsePersonId(value) {
  const id = typeof value === "string" ? cleanText(value) : null;
  if (id === null || id.length > 100) throw new BadInput("Choose who to link it to.");
  return id;
}

/**
 * My name for a connection: sealed in the browser, or empty.
 * @param {unknown} value
 * @returns {string | null}
 */
export function parseLabel(value) {
  let label;
  try {
    label = encryptedText(value);
  } catch {
    throw new BadInput("Couldn't connect: its name wasn't encrypted. Reload the page and try again.");
  }
  if (label !== null && label.length > MAX_SEALED_LABEL) throw new BadInput("That name is too long.");
  return label;
}

/**
 * Accepting an offer: POST /api/connections with { offer, person_id, label }.
 * @param {Record<string, unknown>} body
 * @returns {{ offer: string, personId: string, label: string | null }}
 */
export function parseAccept(body) {
  return { offer: parseOfferToken(body.offer), personId: parsePersonId(body.person_id), label: parseLabel(body.label) };
}

/**
 * Whether removing a connection also clears my About from their card:
 * ?about=remove|keep, required, so a forgotten choice is a 400 rather than
 * a guess.
 * @param {string | null} value
 * @returns {boolean}
 */
export function parseAboutChoice(value) {
  if (value === "remove") return true;
  if (value === "keep") return false;
  throw new BadInput("Choose whether to remove your About from their card.");
}
