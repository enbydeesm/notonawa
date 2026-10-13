// Request checks applied before any route. Pure, so they're easy to test.

/**
 * Anything that changes data must come from the app's own pages: the browser
 * sends an Origin header on those requests, and another site can't fake it.
 * This blocks cross-site request forgery even in a browser that ignores the
 * cookie's SameSite setting.
 * @param {Request} request
 * @param {string} origin the app's own, e.g. https://rope-app.example.workers.dev
 */
export function isAllowedOrigin(request, origin) {
  if (request.method === "GET" || request.method === "HEAD") return true;
  return request.headers.get("origin") === origin;
}

/**
 * What a recovery-code session may do, apart from the /api/auth/ routes
 * (adding a passkey, signing out): see its account. Everything else waits
 * until a passkey has been added.
 * @param {string} method
 * @param {string} path
 */
export function allowedInRecovery(method, path) {
  return method === "GET" && path === "/api/account";
}

/**
 * The key sign-in attempts are counted under: the visitor's IP address,
 * which Cloudflare adds. It's only used in memory to count attempts.
 * @param {Request} request
 */
export function rateLimitKey(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}
