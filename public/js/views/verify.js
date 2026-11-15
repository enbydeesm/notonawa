// /verify#<60 digits>: a safety number scanned from a connected account's
// phone (contact-verify.js shows it as a QR code). If it's the number I
// have with one of my contacts, no one came between our accounts: that
// contact is marked verified. The number is taken out of the address at
// once, so it isn't kept in the browser's history.

import { errorMessage } from "../api.js";
import { h, $ } from "../dom.js";
import { verifyScanned } from "../store/index.js";

/** @param {string} hash location.hash */
export const scannedNumber = (hash) => (/^#\d{60}$/.test(hash) ? hash.slice(1) : null);

/**
 * @param {HTMLElement} root
 * @param {{ signal: AbortSignal }} options
 */
export async function mount(root, { signal }) {
  const body = $("#verify-body", root);
  const say = (/** @type {string} */ text, className = "") => body.replaceChildren(h("p", { id: "verify-said", className }, text));
  const number = scannedNumber(location.hash);
  if (location.hash) history.replaceState(history.state, "", location.pathname);
  if (!number) return say("Scan a connected account's safety number, from their card in People on their phone, to verify it here.");
  say("Checking…");
  try {
    const found = await verifyScanned(number);
    if (signal.aborted) return;
    if (found) {
      say(`Verified: your account and ${found.name ?? "theirs"}'s are connected with no one in between. Their card now says so.`);
    } else {
      say("This safety number doesn't match any account you're connected to. If you are connected, someone may have come between "
        + "your accounts: don't mark them verified, and check again with them in person.", "warning-note");
    }
  } catch (err) {
    if (!signal.aborted) say("Couldn't check it: " + errorMessage(err));
  }
}
