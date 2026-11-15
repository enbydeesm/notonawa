// The choices a share is made with, and how a share is described in
// "Shared by me". Pure, so it's easy to test. The server takes the same
// expiry values (src/shares/parse.js EXPIRY).

/** How long a share lasts, as the Share dialog offers it. */
export const EXPIRY_CHOICES = /** @type {const} */ ([
  { value: "10m", label: "10 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "Until I revoke it" },
]);
export const DEFAULT_EXPIRY = "1d";
/** A profile invite's: long enough to pass on and be accepted (its intro mailbox lasts as long). */
export const DEFAULT_INVITE_EXPIRY = "7d";

/** Who can use it: one person, or anyone with the code. */
export const USE_CHOICES = /** @type {const} */ ([
  { value: "one", label: "One person" },
  { value: "any", label: "Anyone with the code" },
]);

/** What each kind of share is called. */
export const KIND_NAMES = /** @type {const} */ ({ profile: "Profile", tie: "Tie", plan: "Plan", workshop: "Workshop" });

/**
 * The server's max_uses for a "who can use it" choice.
 * @param {string} uses "one" or "any"
 * @returns {1 | null}
 */
export function maxUsesFor(uses) {
  return uses === "any" ? null : 1;
}

/**
 * A warning for a share anyone could use for good, or null. A code that
 * never ends and works for anyone works for whoever ever sees it; one that
 * also connects accounts lets them all connect to mine.
 * @param {string} expires
 * @param {string} uses
 * @param {boolean} [connect] it offers to connect our accounts
 * @returns {string | null}
 */
export function shareWarning(expires, uses, connect = false) {
  if (expires !== "never" || uses !== "any") return null;
  return connect
    ? "Anyone who ever sees this code can use it to connect to your account, until you revoke it. Don't post it anywhere public."
    : "Anyone who ever sees this code can use it, until you revoke it. Don't post it anywhere public.";
}

/**
 * When a share ends, in words.
 * @param {string | null} expiresAt ISO timestamp, or null: until revoked
 * @param {number} [now]
 * @returns {string}
 */
export function endsText(expiresAt, now = Date.now()) {
  if (expiresAt === null) return "until you revoke it";
  const minutes = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 60_000));
  if (minutes < 60) return `ends in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `ends in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `ends in ${Math.round(hours / 24)} days`;
}

/**
 * How much a share has been used, in words.
 * @param {number} useCount
 * @param {number | null} maxUses
 * @returns {string}
 */
export function usesText(useCount, maxUses) {
  if (useCount === 0) return "not opened yet";
  if (maxUses === null) return useCount === 1 ? "opened once" : `opened ${useCount} times`;
  return `opened ${useCount} of ${maxUses} times`;
}

/**
 * A share's link: the app's /open, with the share's id and key after "#",
 * which the browser never sends to the server.
 * @param {string} origin location.origin
 * @param {string} id
 * @param {string} key base64url
 */
export function shareLink(origin, id, key) {
  return `${origin}/open#${id}.${key}`;
}
