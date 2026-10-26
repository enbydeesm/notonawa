// The share a link brought me here to open, held in memory only, so its key
// survives signing in and unlocking (the app is one page) without being
// written anywhere. The key is taken out of the address as soon as the page
// has it, so it doesn't sit in the address bar or the history entry.
//
// Once opened, the share's contents are kept here too, so coming back to
// /open shows them again rather than spending another use. Both are
// forgotten when the journal locks, and once it's been added.

import { readShareFragment } from "./crypto/share.js";
import { onLock } from "./vault.js";

/**
 * @typedef {{ id: string, key: Uint8Array<ArrayBuffer> }} ShareLink
 * @typedef {{ kind: string, own: boolean, data: unknown, offer: string | null, connectionId: string | null }} OpenedShare
 *   offer: a token to accept its offer to connect our accounts (POST
 *   /api/connections); connectionId: my side of our connection, if we're
 *   connected already.
 */

/** @type {ShareLink | null} */
let link = null;
/** Whether the address had something after /open# that wasn't a share link. */
let damaged = false;
/** @type {OpenedShare | null} */
let opened = null;

/**
 * Reads a share link from the address, if it's /open#…, and takes the "#…"
 * out of it. Run when the page loads, and when only the "#…" changes.
 * @returns {boolean} whether there was one (or one that was damaged)
 */
export function takeShareLink() {
  if (location.pathname.replace(/\/+$/, "") !== "/open" || location.hash.length <= 1) return false;
  const found = readShareFragment(location.hash);
  history.replaceState(history.state, "", "/open");
  forget();
  link = found;
  damaged = !found;
  return true;
}

/** The share waiting to be opened, if any. */
export function pendingShare() {
  return { link, damaged, opened };
}

/**
 * Keeps an opened share's contents, so /open can show them again.
 * @param {OpenedShare} share
 */
export function keepOpened(share) {
  opened = share;
}

/** Forgets the waiting share (added, or locked). */
export function forget() {
  link?.key.fill(0);
  link = null;
  damaged = false;
  opened = null;
}

onLock(forget);
