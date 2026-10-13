// Cloudflare Access token verification.
//
// Access signs each request with a JWT in the Cf-Access-Jwt-Assertion header.
// verifyAccessJwt checks its signature, expiry, issuer and audience. The key
// lookup is passed in, so tests can supply their own keys.

/**
 * @typedef {(teamDomain: string, kid: string) => Promise<CryptoKey | null>} KeyLookup
 */

/**
 * Returns the signed-in email, or null if anything is off.
 * @param {string} token
 * @param {{ teamDomain: string, aud: string }} settings
 * @param {KeyLookup} getKey
 * @param {number} [nowSeconds]
 * @returns {Promise<string | null>}
 */
export async function verifyAccessJwt(token, { teamDomain, aud }, getKey, nowSeconds = Date.now() / 1000) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;

  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart)));
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const key = await getKey(teamDomain, header.kid);
  if (!key) return null;

  let valid;
  try {
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlDecode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`)
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  if (typeof payload.exp !== "number" || payload.exp < nowSeconds) return null;
  if (typeof payload.nbf === "number" && payload.nbf > nowSeconds + 60) return null;
  if (payload.iss !== teamDomain) return null;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) return null;

  return typeof payload.email === "string" && payload.email ? payload.email : null;
}

/**
 * Normalises the ACCESS_TEAM_DOMAIN setting to e.g.
 * "https://yourteam.cloudflareaccess.com", whether or not it includes the
 * https:// or a trailing slash.
 * @param {string | undefined} setting
 * @returns {string | null}
 */
export function normaliseTeamDomain(setting) {
  const domain = (setting || "").trim().replace(/\/+$/, "");
  if (!domain) return null;
  return domain.startsWith("https://") ? domain : `https://${domain}`;
}

/**
 * Access's public signing keys, cached. Refetched hourly, or sooner when a
 * token uses a key we haven't seen (Access rotates keys), but at most once a
 * minute.
 * @param {typeof fetch} fetchFn
 * @returns {KeyLookup}
 */
export function createAccessKeyStore(fetchFn = fetch) {
  let byKid = new Map();
  let fetchedAt = 0;

  return async function getKey(teamDomain, kid) {
    const age = Date.now() - fetchedAt;
    const stale = age > 60 * 60 * 1000;
    const unknownKid = !byKid.has(kid) && age > 60 * 1000;

    if (stale || unknownKid) {
      try {
        const res = await fetchFn(`${teamDomain}/cdn-cgi/access/certs`);
        if (!res.ok) throw new Error(`certs fetch failed: ${res.status}`);
        const { keys } = /** @type {{ keys: (JsonWebKey & { kid: string })[] }} */ (await res.json());
        const fresh = new Map();
        for (const jwk of keys) {
          const key = await crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["verify"]
          );
          fresh.set(jwk.kid, key);
        }
        byKid = fresh;
        fetchedAt = Date.now();
      } catch (err) {
        console.error("Couldn't load Access signing keys", err);
      }
    }

    return byKid.get(kid) || null;
  };
}

/** @param {string} text */
export function base64UrlDecode(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
