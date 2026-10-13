// The session cookie. Pure, so it's easy to test.
//
// __Host- makes the browser insist on Secure, Path=/ and no Domain, so no
// other site (or subdomain) can set or read it. HttpOnly keeps it from
// scripts, and SameSite=Strict keeps other sites' requests from carrying it.

export const SESSION_COOKIE = "__Host-session";

/**
 * @param {Request} request
 * @returns {string | null}
 */
export function readSessionToken(request) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/**
 * @param {string} token
 * @param {number} maxAgeSeconds
 */
export function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
}
