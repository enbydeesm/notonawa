// Rope Journal - Worker script
// Sits between your pages (in /public) and the database (env.DB).
// Anything under /api/ is handled here; everything else is served from /public.

// SQL for "now" as an ISO timestamp, e.g. '2026-10-11T21:51:00Z'.
// Every timestamp the app writes uses this format.
const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Not an API request? Serve the page files.
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // Figure out who is asking. Every API request needs a known user.
    const user = await getUser(request, env);
    if (!user) {
      return json({ error: "Not signed in" }, 401);
    }

    try {
      // GET /api/ties  -> list my ties, newest first
      if (url.pathname === "/api/ties" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT id, title, tie_date, duration_minutes, success_rating, notes, created_at
             FROM ties
            WHERE owner_id = ?
            ORDER BY tie_date DESC, created_at DESC`
        )
          .bind(user.id)
          .all();
        return json(results);
      }

      // POST /api/ties -> add a new tie
      if (url.pathname === "/api/ties" && request.method === "POST") {
        const body = await request.json();

        const title = cleanText(body.title);
        const tieDate = cleanText(body.tie_date);
        const notes = cleanText(body.notes);
        const duration = toIntOrNull(body.duration_minutes, 0, 1440);
        const success = toIntOrNull(body.success_rating, 1, 5);

        if (!title && !tieDate) {
          return json({ error: "Add at least a title or a date." }, 400);
        }

        const id = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO ties (id, owner_id, title, tie_date, duration_minutes, success_rating, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(id, user.id, title, tieDate, duration, success, notes)
          .run();

        return json({ id }, 201);
      }

      // Plans, people and locations can each be archived (hidden from pickers
      // and most views until restored) or deleted for good. The table name in
      // these routes only ever comes from the fixed alternatives in the
      // patterns, so it's safe to put in SQL.

      // POST /api/plans/:id/archive, /api/people/:id/archive, /api/locations/:id/archive
      // Archiving again keeps the original date. A plan's stage is left alone,
      // so restoring brings it back exactly as it was.
      const archiveMatch = url.pathname.match(/^\/api\/(plans|people|locations)\/([^/]+)\/archive$/);
      if (archiveMatch && request.method === "POST") {
        const row = await env.DB.prepare(
          `UPDATE ${archiveMatch[1]}
              SET archived_at = COALESCE(archived_at, ${NOW}),
                  updated_at = ${NOW}
            WHERE id = ? AND owner_id = ?
           RETURNING id, archived_at`
        )
          .bind(archiveMatch[2], user.id)
          .first();
        if (!row) return json({ error: "Not found" }, 404);
        return json(row);
      }

      // POST /api/plans/:id/restore, /api/people/:id/restore, /api/locations/:id/restore
      const restoreMatch = url.pathname.match(/^\/api\/(plans|people|locations)\/([^/]+)\/restore$/);
      if (restoreMatch && request.method === "POST") {
        const row = await env.DB.prepare(
          `UPDATE ${restoreMatch[1]}
              SET archived_at = NULL,
                  updated_at = ${NOW}
            WHERE id = ? AND owner_id = ? AND archived_at IS NOT NULL
           RETURNING id`
        )
          .bind(restoreMatch[2], user.id)
          .first();
        if (!row) return json({ error: "Not found" }, 404);
        return json(row);
      }

      // DELETE /api/people/:id, /api/locations/:id -> delete for good.
      // A deleted person's tie_participants rows stay, with person_id set to
      // NULL (shown as "(person deleted)"). A deleted location's ties stay,
      // with location_id NULL and location_deleted = 1 ("(location deleted)").
      const deleteMatch = url.pathname.match(/^\/api\/(people|locations)\/([^/]+)$/);
      if (deleteMatch && request.method === "DELETE") {
        const row = await env.DB.prepare(
          `DELETE FROM ${deleteMatch[1]} WHERE id = ? AND owner_id = ? RETURNING id`
        )
          .bind(deleteMatch[2], user.id)
          .first();
        if (!row) return json({ error: "Not found" }, 404);
        return new Response(null, { status: 204 });
      }

      // DELETE /api/plans/:id?linked_ties=remove|keep -> delete for good.
      // The UI must ask which one the user wants, so there's no default:
      //   remove: also delete the plan's tie_plans rows, so ties show no trace of it
      //   keep:   tie_plans rows stay with plan_id NULL ("(plan deleted)")
      const planDeleteMatch = url.pathname.match(/^\/api\/plans\/([^/]+)$/);
      if (planDeleteMatch && request.method === "DELETE") {
        const planId = planDeleteMatch[1];
        const linkedTies = url.searchParams.get("linked_ties");
        if (linkedTies !== "remove" && linkedTies !== "keep") {
          return json({ error: "Say what to do with linked ties: linked_ties=remove or linked_ties=keep." }, 400);
        }

        const deletePlan = env.DB.prepare(
          "DELETE FROM plans WHERE id = ? AND owner_id = ? RETURNING id"
        ).bind(planId, user.id);

        let deleted;
        if (linkedTies === "remove") {
          // One batch = one transaction, so the links and the plan go together.
          const [, planResult] = await env.DB.batch([
            env.DB.prepare(
              `DELETE FROM tie_plans
                WHERE plan_id = (SELECT id FROM plans WHERE id = ? AND owner_id = ?)`
            ).bind(planId, user.id),
            deletePlan,
          ]);
          deleted = planResult.results.length > 0;
        } else {
          deleted = (await deletePlan.first()) !== null;
        }

        if (!deleted) return json({ error: "Not found" }, 404);
        return new Response(null, { status: 204 });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      if (err instanceof BadInput) {
        return json({ error: err.message }, 400);
      }
      // Linking to something that doesn't exist, or that belongs to another
      // user (rejected by the ownership triggers). Same message for both so we
      // don't reveal whether someone else's item exists.
      if (/ownership mismatch|FOREIGN KEY constraint failed/.test(err.message)) {
        return json({ error: "Linked item not found." }, 400);
      }
      console.error(err);
      return json({ error: "Something went wrong" }, 500);
    }
  },
};

// --- helpers ---------------------------------------------------------------

// Cloudflare Access signs each request with a JWT in the Cf-Access-Jwt-Assertion
// header. We verify that token and take the email from it, so a request that
// reaches the Worker without going through Access can't claim to be anyone.
//
// When running locally (wrangler dev) there is no Access, so on localhost only
// we fall back to DEV_USER_EMAIL from the .dev.vars file, which only exists on your Mac.
async function getUser(request, env) {
  let email = null;

  const token = request.headers.get("cf-access-jwt-assertion");
  if (token) {
    email = await verifyAccessJwt(token, env);
  } else if (isLocalhost(request) && env.DEV_USER_EMAIL) {
    email = env.DEV_USER_EMAIL;
  }
  if (!email) return null;

  // Usually one read. Only the very first request for a new email writes.
  const user = await env.DB.prepare("SELECT id, email FROM users WHERE email = ?")
    .bind(email)
    .first();
  if (user) return user;

  // First time we see this email: create the user. If two first requests race,
  // the loser hits the conflict, and the no-op DO UPDATE makes RETURNING give
  // back the row the winner created.
  return env.DB.prepare(
    `INSERT INTO users (id, email) VALUES (?, ?)
     ON CONFLICT(email) DO UPDATE SET email = excluded.email
     RETURNING id, email`
  )
    .bind(crypto.randomUUID(), email)
    .first();
}

function isLocalhost(request) {
  const { hostname } = new URL(request.url);
  return hostname === "localhost" || hostname === "127.0.0.1";
}

// Checks the Access JWT's signature, expiry, issuer and audience.
// Returns the signed-in email, or null if anything is off.
async function verifyAccessJwt(token, env) {
  const teamDomain = accessTeamDomain(env);
  if (!teamDomain || !env.ACCESS_AUD) {
    console.error("ACCESS_TEAM_DOMAIN and ACCESS_AUD must be set to verify Access tokens");
    return null;
  }

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
  if (header.alg !== "RS256") return null;

  const key = await getAccessKey(teamDomain, header.kid);
  if (!key) return null;

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`)
  );
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
  if (payload.iss !== teamDomain) return null;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(env.ACCESS_AUD)) return null;

  return typeof payload.email === "string" && payload.email ? payload.email : null;
}

// e.g. "https://yourteam.cloudflareaccess.com", whether or not the setting
// includes the https:// or a trailing slash.
function accessTeamDomain(env) {
  const domain = (env.ACCESS_TEAM_DOMAIN || "").trim().replace(/\/+$/, "");
  if (!domain) return null;
  return domain.startsWith("https://") ? domain : `https://${domain}`;
}

// Access's public signing keys, cached per Worker instance. Refetched hourly,
// or sooner when a token uses a key we haven't seen (Access rotates keys),
// but at most once a minute.
const accessKeys = { byKid: new Map(), fetchedAt: 0 };

async function getAccessKey(teamDomain, kid) {
  const age = Date.now() - accessKeys.fetchedAt;
  const stale = age > 60 * 60 * 1000;
  const unknownKid = !accessKeys.byKid.has(kid) && age > 60 * 1000;

  if (stale || unknownKid) {
    try {
      const res = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
      if (!res.ok) throw new Error(`certs fetch failed: ${res.status}`);
      const { keys } = await res.json();
      const byKid = new Map();
      for (const jwk of keys) {
        const key = await crypto.subtle.importKey(
          "jwk",
          jwk,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"]
        );
        byKid.set(jwk.kid, key);
      }
      accessKeys.byKid = byKid;
      accessKeys.fetchedAt = Date.now();
    } catch (err) {
      console.error("Couldn't load Access signing keys", err);
    }
  }

  return accessKeys.byKid.get(kid) || null;
}

function base64UrlDecode(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

class BadInput extends Error {}

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function toIntOrNull(value, min, max) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadInput(`Expected a whole number from ${min} to ${max}.`);
  }
  return n;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
