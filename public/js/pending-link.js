// A new device's sign-in request, scanned from its QR code (/link#…), held
// in memory only so it survives signing in and unlocking (the app is one
// page). Taken out of the address as soon as the page has it, as share
// links are (pending-share.js). Forgotten when the journal locks, and once
// approved or declined.

import { readLinkFragment } from "./crypto/link.js";
import { onLock } from "./vault.js";

/** @type {{ id: string, keyHash: string } | null} */
let scanned = null;
/** Whether the address had something after /link# that wasn't a request. */
let damaged = false;

/**
 * Reads a request from the address, if it's /link#…, and takes the "#…"
 * out of it. Run when the page loads, and when only the "#…" changes.
 * @returns {boolean} whether there was one (or one that was damaged)
 */
export function takeLinkFragment() {
  if (location.pathname.replace(/\/+$/, "") !== "/link" || location.hash.length <= 1) return false;
  const found = readLinkFragment(location.hash);
  history.replaceState(history.state, "", "/link");
  scanned = found;
  damaged = !found;
  return true;
}

/** The request waiting to be approved, if any. */
export function pendingLink() {
  return { scanned, damaged };
}

/** Forgets it (approved, declined, or locked). */
export function forgetLink() {
  scanned = null;
  damaged = false;
}

onLock(forgetLink);
