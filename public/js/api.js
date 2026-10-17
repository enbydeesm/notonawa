// Talking to the Worker's API.

import { navigate } from "./navigate.js";
import { lock } from "./vault.js";
import { consentRequired } from "./consent-state.js";

// An error from the API, with its status and body. reauth: the change needs
// the user to confirm it's them with their passkey first (see account.js).
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {any} data
   */
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.reauth = !!data?.reauth;
  }
}

/**
 * Calls the API. Throws an ApiError with the API's message on failure.
 * Signed out (or signed in with a recovery code and no passkey yet), it goes
 * to the sign-in view instead, unless it's already there.
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options] body: sent as JSON,
 *   or as it is if it's an ArrayBuffer (a sealed photo)
 * @returns {Promise<any>}
 */
export async function api(path, { method = "GET", body } = {}) {
  const raw = body instanceof ArrayBuffer;
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": raw ? "application/octet-stream" : "application/json" },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  /** @type {any} */
  let data = null;
  try {
    data = await res.json();
  } catch {
    // not JSON
  }
  const toSignIn = res.status === 401 || (res.status === 403 && data?.recovery);
  // The session has ended (or never was): lock, whatever happens next.
  if (toSignIn) lock();
  if (toSignIn && location.pathname !== "/signin") {
    // Replacing this entry, so Back doesn't return to a view that would only
    // send you here again. Several requests may fail at once; the first one
    // goes, and the rest see they're already here.
    navigate("/signin", { replace: true });
    // Never settles: the view that asked is going away.
    return new Promise(() => {});
  }
  // The privacy policy changed and I haven't agreed yet: the app shows the
  // agreement in place of the journal (app.js).
  if (res.status === 403 && data?.consent) consentRequired();
  if (!res.ok) throw new ApiError(data?.error || res.statusText, res.status, data);
  return data;
}

/**
 * The message to show for a caught error.
 * @param {unknown} err
 */
export function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
