// Talking to the Worker's API.

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
 * to the sign-in page instead, unless it's already there.
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>}
 */
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
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
  if (toSignIn && location.pathname !== "/signin") {
    location.href = "/signin";
    // Never settles: the page is going away.
    return new Promise(() => {});
  }
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
