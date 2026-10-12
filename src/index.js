// Rope Journal - Worker script
// Sits between your pages (in /public) and the database (env.DB).
// Anything under /api/ is handled here; everything else is served from /public.

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

      return json({ error: "Not found" }, 404);
    } catch (err) {
      if (err instanceof BadInput) {
        return json({ error: err.message }, 400);
      }
      console.error(err);
      return json({ error: "Something went wrong" }, 500);
    }
  },
};

// --- helpers ---------------------------------------------------------------

// Cloudflare Access adds the signed-in email to each request.
// When running locally (wrangler dev) there is no Access, so we fall back to
// DEV_USER_EMAIL from the .dev.vars file, which only exists on your Mac.
async function getUser(request, env) {
  const email =
    request.headers.get("cf-access-authenticated-user-email") || env.DEV_USER_EMAIL;
  if (!email) return null;

  // Create the user record the first time we see this email.
  await env.DB.prepare(
    "INSERT INTO users (id, email) VALUES (?, ?) ON CONFLICT(email) DO NOTHING"
  )
    .bind(crypto.randomUUID(), email)
    .run();

  return env.DB.prepare("SELECT id, email FROM users WHERE email = ?")
    .bind(email)
    .first();
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
