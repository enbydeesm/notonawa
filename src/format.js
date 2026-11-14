// The format gate: which API routes an account may use, by its format
// (users.format, migration 0032). Format 1 accounts use the format 1 journal
// routes (ties, plans, people, …); format 2 accounts use sealed records,
// files, their identity key and mailboxes. While a format 1 account is being
// converted, it may use both, but may no longer change its format 1 journal,
// so nothing lands in the old tables after the conversion has read them.
// Pure, so it's easy to test; src/index.js applies it to every signed-in
// request.

/** @typedef {{ format: 1 | 2, converting: boolean }} Format */
/** @typedef {{ status: 409 | 410, error: string, reload: true }} Refusal */

// The format 1 journal: everything under these. /api/locations/coords
// (reading a map link's coordinates) is allowed to both, and so is the
// export: a format 2 account's has its account part only (passkeys,
// notices, feedback, shares), its journal added on the device.
const V1 = /^\/api\/(ties|workshops|plans|people|locations|tags|stats|data|media|drawings|poses|pose-presets|visuals|encryption|connections)(\/|$)/;
const BOTH = new Set(["/api/locations/coords", "/api/data/export"]);
// Format 1 POSTs that only read, so a converting account may still use them.
const V1_READS = new Set(["/api/ties/search", "/api/stats/ties"]);

// Format 2's routes. Mailboxes only once converted: nothing during the
// conversion needs them. (Leaving a message, POST /api/mailboxes/:id/
// messages, needs no session, so it's routed before the gate.)
const V2 = /^\/api\/(sync|records|files|identity)(\/|$)/;
const V2_ONLY = /^\/api\/mailboxes(\/|$)/;

const RELOAD = "Reload the app to use this.";

/**
 * @param {string} pathname
 * @returns {"v1" | "v2" | "v2-only" | null} which format's route it is, if either's
 */
export function routeFormat(pathname) {
  if (BOTH.has(pathname)) return null;
  if (V1.test(pathname)) return "v1";
  if (V2.test(pathname)) return "v2";
  if (V2_ONLY.test(pathname)) return "v2-only";
  return null;
}

/**
 * Whether the account may use this route, and if not, the answer: 410 for a
 * route its format doesn't have (the page is older or newer than the
 * account: reloading fixes it), 409 for a change to the format 1 journal
 * while it's being converted.
 * @param {Format} account
 * @param {string} method
 * @param {string} pathname
 * @returns {Refusal | null}
 */
export function formatRefusal({ format, converting }, method, pathname) {
  const route = routeFormat(pathname);
  if (route === "v1") {
    if (format === 2) return { status: 410, error: RELOAD, reload: true };
    const reads = method === "GET" || method === "HEAD" || (method === "POST" && V1_READS.has(pathname));
    if (converting && !reads) {
      return { status: 409, error: "Your journal is being updated, so this can't be saved. Reload the app.", reload: true };
    }
  }
  if (route === "v2" && format !== 2 && !converting) return { status: 410, error: RELOAD, reload: true };
  if (route === "v2-only" && format !== 2) return { status: 410, error: RELOAD, reload: true };
  return null;
}

/**
 * The format new accounts start in: NEW_ACCOUNT_FORMAT in wrangler.jsonc,
 * "1" or "2". Anything else is format 1, today's.
 * @param {string | undefined} value
 * @returns {1 | 2}
 */
export function newAccountFormat(value) {
  return value === "2" ? 2 : 1;
}
