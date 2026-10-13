// Security headers for every response the Worker sends: API answers, errors,
// and anything it passes through from ASSETS. Static files served straight
// from public/ (without running the Worker) get theirs from public/_headers;
// keep the shared ones (everything but the CSP) the same in both.

// The API only ever returns JSON, so it needs no scripts, styles or frames.
export const SECURITY_HEADERS = Object.freeze({
  // Journal data must never be kept in a browser or proxy cache.
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  // No includeSubDomains while the app is on workers.dev (see considerations.md).
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

/**
 * Returns the response with the security headers added. A header the response
 * already has is kept, so pages passed through from ASSETS keep the CSP from
 * public/_headers.
 * @param {Response} response
 * @returns {Response}
 */
export function withSecurityHeaders(response) {
  // Copy, because responses from fetch() (including ASSETS) have locked headers.
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  return secured;
}
