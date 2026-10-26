// Agreeing to the privacy policy again after it changes. Pure, so it's easy
// to test. The versions are in src/policy-version.js (made from PRIVACY.md).

/**
 * Whether someone who agreed to `agreed` must agree again: they agreed to a
 * version older than `oldestAccepted` (versions are ISO times, or an older
 * dated name, so they sort by date as text).
 * @param {string | null} agreed users.terms_version
 * @param {string} oldestAccepted CONSENT_VERSION
 */
export function needsConsent(agreed, oldestAccepted) {
  return !agreed || agreed < oldestAccepted;
}

/**
 * What someone who hasn't agreed to the new version may still do: read
 * (their journal, its export and its photos), agree, delete their account
 * or change its settings, remove a connection to another account, unlock (which can update their passkey's locked
 * key, or encrypt older notes), and dismiss notices. Nothing new goes into
 * their journal until they agree.
 * @param {string} method
 * @param {string} path
 */
export function allowedWithoutConsent(method, path) {
  if (method === "GET" || method === "HEAD") return true;
  return path === "/api/consent"
    || path === "/api/account" || path.startsWith("/api/account/")
    || path.startsWith("/api/keys/")
    || path === "/api/encryption/seal"
    || path.startsWith("/api/notices/")
    || (method === "DELETE" && path.startsWith("/api/connections/"));
}
