// Shares: limits, request parsing and where their files go. Pure, so it's
// easy to test.
//
// A share is a sealed copy of a profile, tie, plan or workshop. The browser
// seals it with a key that's only in the link (public/js/crypto/share.js),
// so we store and hand back bytes we can't open. See considerations.md,
// "Sharing between accounts".

import { BadInput } from "../http.js";
import { encryptedText } from "../parse.js";
import { MAX_ACCOUNT_BYTES } from "../media/parse.js";

export const SHARE_KINDS = /** @type {const} */ (["profile", "tie", "plan", "workshop"]);

/**
 * How long a share lasts, as the page offers it, and the SQLite modifier
 * that adds it to now (null: until it's revoked). Only these fixed
 * modifiers reach SQL.
 */
export const EXPIRY = /** @type {const} */ ({
  "10m": "+10 minutes", "1h": "+1 hour", "1d": "+1 day", "7d": "+7 days", "30d": "+30 days", never: null,
});

/** The most times a share can be opened, when it's limited at all. */
export const MAX_USES = 100;
/** The largest sealed snapshot (its text, drawings and poses; photos are separate files). */
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
/** Shares an account can have live at once. */
export const MAX_LIVE_SHARES = 50;
/** A sealed label (a label is short; sealing adds a third and more). */
export const MAX_SEALED_LABEL = 1000;
// A 12-byte IV and a 16-byte tag: anything shorter can't be sealed.
const MIN_SNAPSHOT_BYTES = 28;

// 16 random bytes, base64url, made in the browser (crypto/share.js).
const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** @typedef {typeof SHARE_KINDS[number]} ShareKind */

/**
 * @typedef {{
 *   id: string, kind: ShareKind, label: string | null, linkKey: string,
 *   expires: string | null, maxUses: number | null, snapshot: Uint8Array,
 * }} NewShare
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function parseShareId(value) {
  if (typeof value !== "string" || !SHARE_ID.test(value)) throw new BadInput("That isn't a share id.");
  return value;
}

/**
 * A new share: POST /api/shares with { id, kind, label, link_key, expires,
 * max_uses, snapshot } (the snapshot sealed, as base64url; the label and
 * link key sealed with the owner's data key).
 * @param {Record<string, any>} body
 * @returns {NewShare}
 */
export function parseNewShare(body) {
  const id = parseShareId(body.id);
  if (!SHARE_KINDS.includes(body.kind)) throw new BadInput("Only a profile, tie, plan or workshop can be shared.");
  if (!Object.hasOwn(EXPIRY, body.expires)) throw new BadInput("Choose how long the share lasts.");
  const maxUses = body.max_uses ?? null;
  if (maxUses !== null && !(Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= MAX_USES)) {
    throw new BadInput(`A share can be opened between 1 and ${MAX_USES} times, or any number.`);
  }
  return {
    id, kind: body.kind, label: parseLabel(body.label), linkKey: parseLinkKey(body.link_key),
    expires: EXPIRY[/** @type {keyof typeof EXPIRY} */ (body.expires)], maxUses, snapshot: parseSnapshot(body.snapshot),
  };
}

/**
 * The sender's name for a share: sealed in the browser, or empty.
 * @param {unknown} value
 * @returns {string | null}
 */
function parseLabel(value) {
  let label;
  try {
    label = encryptedText(value);
  } catch {
    throw new BadInput("Couldn't share: its name wasn't encrypted. Reload the page and try again.");
  }
  if (label !== null && label.length > MAX_SEALED_LABEL) throw new BadInput("That name is too long.");
  return label;
}

/**
 * The link's key, sealed in the browser so its owner can show the code
 * again. Required: every share keeps one.
 * @param {unknown} value
 * @returns {string}
 */
function parseLinkKey(value) {
  let key;
  try {
    key = encryptedText(value);
  } catch {
    key = null;
  }
  if (key === null || key.length > MAX_SEALED_LABEL) {
    throw new BadInput("Couldn't share: its key wasn't encrypted. Reload the page and try again.");
  }
  return key;
}

/**
 * @param {unknown} value base64url
 * @returns {Uint8Array}
 */
function parseSnapshot(value) {
  // Checked before decoding, so nothing too big is decoded.
  if (typeof value !== "string" || !BASE64URL.test(value) || value.length > Math.ceil(MAX_SNAPSHOT_BYTES * 4 / 3)) {
    throw new BadInput("Couldn't share: it's too big, or didn't arrive whole.");
  }
  let bytes;
  try {
    bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch {
    throw new BadInput("Couldn't share: it's too big, or didn't arrive whole.");
  }
  if (bytes.length < MIN_SNAPSHOT_BYTES || bytes.length > MAX_SNAPSHOT_BYTES) {
    throw new BadInput("Couldn't share: it's too big, or didn't arrive whole.");
  }
  return bytes;
}

/**
 * Why a new share can't be kept, or null if it can.
 * @param {{ live: number, accountBytes: number }} used the account's live shares, and its bytes in R2
 * @param {number} bytes the new share's
 * @returns {string | null}
 */
export function shareProblem({ live, accountBytes }, bytes) {
  if (live >= MAX_LIVE_SHARES) return `You can have at most ${MAX_LIVE_SHARES} shares at once. Revoke some to share more.`;
  if (accountBytes + bytes > MAX_ACCOUNT_BYTES) return "Your photos, videos and shares have filled your 1 GB. Delete some to make room.";
  return null;
}

/**
 * Bytes as base64url, as the page sends and reads them.
 * @param {ArrayBuffer | Uint8Array} data
 * @returns {string}
 */
export function toBase64url(data) {
  const bytes = new Uint8Array(data);
  let binary = "";
  // In pieces: a 2 MB spread into fromCharCode would overflow the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// R2 keys. A share's files sit in its owner's folder, beside their photos
// ("<owner id>/<photo id>"), so deleting an account's files takes its
// shares' too.

/**
 * @param {string} ownerId
 * @param {string} shareId
 */
export const sharePrefix = (ownerId, shareId) => `${ownerId}/shares/${shareId}/`;

/**
 * @param {string} ownerId
 * @param {string} shareId
 */
export const snapshotKey = (ownerId, shareId) => `${sharePrefix(ownerId, shareId)}snapshot`;

/**
 * Which share an R2 key belongs to, or null if it isn't a share's.
 * @param {string} key
 * @returns {{ ownerId: string, shareId: string } | null}
 */
export function shareOfKey(key) {
  const match = key.match(/^([^/]+)\/shares\/([^/]+)\/[^/]+$/);
  return match ? { ownerId: match[1], shareId: match[2] } : null;
}
