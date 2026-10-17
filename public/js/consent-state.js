// Whether I must agree to the updated privacy policy before going on
// (GET /api/consent). Kept apart from app.js so api.js can mark it when the
// server refuses a change for that reason.

/** @typedef {{ needed: boolean, version: string, summary: string | null }} ConsentState */

/** @type {ConsentState | null} null: not asked yet (since unlocking) */
let state = null;
/** @type {() => void} */
let onNeeded = () => {};

export const consentState = () => state;

/** @param {ConsentState | null} next */
export function setConsentState(next) {
  state = next;
}

/** The server refused a change until I agree: show the agreement. */
export function consentRequired() {
  const wasNeeded = state?.needed;
  state = state ? { ...state, needed: true } : null;
  if (!wasNeeded) onNeeded();
}

/** @param {() => void} fn */
export function onConsentRequired(fn) {
  onNeeded = fn;
}
