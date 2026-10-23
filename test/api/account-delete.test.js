import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { call, createOtherUser, sessionCookieFor, sql } from "../helpers.js";
import { isoAt } from "../../src/auth/session.js";

// Every table, and how to count one user's rows in it (child rows through
// their parent).
const OWNED_ROWS = {
  users: "SELECT count(*) AS n FROM users WHERE id = ?",
  passkeys: "SELECT count(*) AS n FROM passkeys WHERE user_id = ?",
  sessions: "SELECT count(*) AS n FROM sessions WHERE user_id = ?",
  auth_challenges: "SELECT count(*) AS n FROM auth_challenges WHERE user_id = ?",
  people: "SELECT count(*) AS n FROM people WHERE owner_id = ?",
  profile_notes: "SELECT count(*) AS n FROM profile_notes n JOIN people p ON p.id = n.person_id WHERE p.owner_id = ?",
  locations: "SELECT count(*) AS n FROM locations WHERE owner_id = ?",
  tags: "SELECT count(*) AS n FROM tags WHERE owner_id = ?",
  plans: "SELECT count(*) AS n FROM plans WHERE owner_id = ?",
  plan_tags: "SELECT count(*) AS n FROM plan_tags pt JOIN plans p ON p.id = pt.plan_id WHERE p.owner_id = ?",
  ties: "SELECT count(*) AS n FROM ties WHERE owner_id = ?",
  tie_participants: "SELECT count(*) AS n FROM tie_participants tp JOIN ties t ON t.id = tp.tie_id WHERE t.owner_id = ?",
  tie_plans: "SELECT count(*) AS n FROM tie_plans tp JOIN ties t ON t.id = tp.tie_id WHERE t.owner_id = ?",
  tie_tags: "SELECT count(*) AS n FROM tie_tags tt JOIN ties t ON t.id = tt.tie_id WHERE t.owner_id = ?",
  workshops: "SELECT count(*) AS n FROM workshops WHERE owner_id = ?",
  workshop_people: "SELECT count(*) AS n FROM workshop_people wp JOIN workshops w ON w.id = wp.workshop_id WHERE w.owner_id = ?",
  workshop_tags: "SELECT count(*) AS n FROM workshop_tags wt JOIN workshops w ON w.id = wt.workshop_id WHERE w.owner_id = ?",
  invites: "SELECT count(*) AS n FROM invites WHERE used_by = ?",
  key_wraps: "SELECT count(*) AS n FROM key_wraps WHERE user_id = ?",
  media: "SELECT count(*) AS n FROM media WHERE owner_id = ?",
  drawings: "SELECT count(*) AS n FROM drawings WHERE owner_id = ?",
  notices: "SELECT count(*) AS n FROM notices WHERE user_id = ?",
  notice_dismissals: "SELECT count(*) AS n FROM notice_dismissals WHERE user_id = ?",
  feedback: "SELECT count(*) AS n FROM feedback WHERE user_id = ?",
};

// Child rows whose parent is gone: there should never be any.
const ORPHANS = [
  "SELECT count(*) AS n FROM profile_notes WHERE person_id NOT IN (SELECT id FROM people)",
  "SELECT count(*) AS n FROM plan_tags WHERE plan_id NOT IN (SELECT id FROM plans) OR tag_id NOT IN (SELECT id FROM tags)",
  "SELECT count(*) AS n FROM tie_participants WHERE tie_id NOT IN (SELECT id FROM ties)",
  "SELECT count(*) AS n FROM tie_plans WHERE tie_id NOT IN (SELECT id FROM ties)",
  "SELECT count(*) AS n FROM tie_tags WHERE tie_id NOT IN (SELECT id FROM ties) OR tag_id NOT IN (SELECT id FROM tags)",
  "SELECT count(*) AS n FROM workshop_people WHERE workshop_id NOT IN (SELECT id FROM workshops)",
  "SELECT count(*) AS n FROM workshop_tags WHERE workshop_id NOT IN (SELECT id FROM workshops) OR tag_id NOT IN (SELECT id FROM tags)",
  "SELECT count(*) AS n FROM media WHERE workshop_id NOT IN (SELECT id FROM workshops)",
  "SELECT count(*) AS n FROM media WHERE tie_id NOT IN (SELECT id FROM ties) OR plan_id NOT IN (SELECT id FROM plans)",
  `SELECT count(*) AS n FROM drawings WHERE tie_id NOT IN (SELECT id FROM ties) OR plan_id NOT IN (SELECT id FROM plans)
      OR workshop_id NOT IN (SELECT id FROM workshops)`,
];

/** @param {string} userId */
async function countRows(userId) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const [table, query] of Object.entries(OWNED_ROWS)) {
    counts[table] = /** @type {number} */ ((await sql(query, userId).first())?.n);
  }
  return counts;
}

/**
 * A user with something in every table, signed in just now.
 * @returns {Promise<{ id: string, cookie: string }>}
 */
async function userWithEverything() {
  const id = await createOtherUser();
  const cookie = await sessionCookieFor(id);
  const post = async (/** @type {string} */ path, /** @type {any} */ body) => (await call(path, { method: "POST", body, cookie })).body.id;

  await sql("INSERT INTO passkeys (id, user_id, public_key, name) VALUES (?, ?, 'pk', 'Phone')", `pk-${id}`, id).run();
  await sql(`INSERT INTO key_wraps (id, user_id, kind, passkey_id, salt, iv, wrapped, version)
             VALUES (?, ?, 'passkey', ?, 's', 'i', 'w', 1)`, crypto.randomUUID(), id, `pk-${id}`).run();
  await sql(`INSERT INTO key_wraps (id, user_id, kind, recovery_secret_hash, salt, iv, wrapped, version)
             VALUES (?, ?, 'recovery', 'h', 's', 'i', 'w', 1)`, crypto.randomUUID(), id).run();
  await sql("INSERT INTO auth_challenges (challenge, purpose, user_id, expires_at) VALUES (?, 'register', ?, '2999-01-01T00:00:00Z')", `c-${id}`, id).run();
  await sql("INSERT INTO invites (code_hash, used_at, used_by) VALUES (?, '2026-01-01T00:00:00Z', ?)", `inv-${id}`, id).run();
  const sam = await post("/api/people", { name: "Sam" });
  await sql("INSERT INTO profile_notes (id, person_id, type, description) VALUES (?, ?, 'like', 'Hip harnesses')", crypto.randomUUID(), sam).run();
  const loc = await post("/api/locations", { name: "Studio" });
  const plan = await post("/api/plans", { title: "TK" });
  await post("/api/plans", { title: "TK 2", variation_of: plan });
  const tag = crypto.randomUUID();
  await sql("INSERT INTO tags (id, owner_id, name) VALUES (?, ?, 'box')", tag, id).run();
  await sql("INSERT INTO plan_tags (plan_id, tag_id) VALUES (?, ?)", plan, tag).run();
  const tie = await post("/api/ties", { tie_type: "floor", tie_date: "2026-01-01",
    title: "Session", location_id: loc, participants: [{ person_id: sam, role: "bottom" }], plan_ids: [plan], tags: ["box", "floor"],
  });
  const workshop = await post("/api/workshops", { title: "Intro", start_date: "2026-02-01", location_id: loc,
    educators: [{ person_id: sam, role: "top" }], tags: ["box"],
  });
  // Photos' rows (their files are tested in media.test.js).
  await sql(`INSERT INTO media (id, owner_id, tie_id, kind, mime, position, thumb_bytes, bytes)
             VALUES (?, ?, ?, 'photo', 'image/jpeg', 0, 1, 2)`, crypto.randomUUID(), id, tie).run();
  await sql(`INSERT INTO media (id, owner_id, workshop_id, kind, mime, position, thumb_bytes, bytes)
             VALUES (?, ?, ?, 'photo', 'image/jpeg', 0, 1, 2)`, crypto.randomUUID(), id, workshop).run();
  await post("/api/drawings", { tie_id: tie, data: { v: 1, strokes: [{ c: "red", w: 1, p: [1, 1] }] } });
  await post("/api/drawings", { plan_id: plan, data: { v: 1, strokes: [{ c: "blue", w: 1, p: [1, 1] }] } });
  await post("/api/drawings", { workshop_id: workshop, data: { v: 1, strokes: [{ c: "green", w: 1, p: [1, 1] }] } });
  // A notice just for them, dismissed.
  const notice = crypto.randomUUID();
  await sql("INSERT INTO notices (id, user_id, message) VALUES (?, ?, 'Hello')", notice, id).run();
  await sql("INSERT INTO notice_dismissals (notice_id, user_id) VALUES (?, ?)", notice, id).run();
  await post("/api/feedback", { kind: "bug", message: "The + button", app_version: "2026.10.20.001" });
  return { id, cookie };
}

describe("DELETE /api/account", () => {
  it("deletes the account and everything in it, and signs out", async () => {
    const user = await userWithEverything();
    const before = await countRows(user.id);
    for (const [table, n] of Object.entries(before)) expect(n, table).toBeGreaterThan(0);

    const res = await call("/api/account", { method: "DELETE", cookie: user.cookie });
    expect(res).toEqual({ status: 200, body: { passkey_ids: [`pk-${user.id}`] } });
    expect(Object.values(await countRows(user.id)).every((n) => n === 0)).toBe(true);
    // Nothing left over anywhere that belonged to it.
    for (const query of ORPHANS) expect((await sql(query).first())?.n, query).toBe(0);
    // The invite it used stays used, by no one.
    expect(await sql("SELECT used_at, used_by FROM invites WHERE code_hash = ?", `inv-${user.id}`).first())
      .toEqual({ used_at: "2026-01-01T00:00:00Z", used_by: null });
    // The session is gone: the same cookie no longer works.
    expect((await call("/api/account", { cookie: user.cookie })).status).toBe(401);
  });

  it("clears the session cookie", async () => {
    const id = await createOtherUser();
    const { SELF } = await import("cloudflare:test");
    const res = await SELF.fetch("http://localhost/api/account", {
      method: "DELETE", headers: { cookie: await sessionCookieFor(id), origin: "http://localhost" },
    });
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-session=; .*Max-Age=0/);
  });

  it("leaves other users' journals alone, clearing only their links to me", async () => {
    const user = await userWithEverything();
    const other = await userWithEverything();
    const linked = crypto.randomUUID();
    await sql("INSERT INTO people (id, owner_id, name, linked_user_id) VALUES (?, ?, 'Them', ?)", linked, other.id, user.id).run();
    const before = await countRows(other.id);

    await call("/api/account", { method: "DELETE", cookie: user.cookie });
    expect(await countRows(other.id)).toEqual(before);
    expect(await sql("SELECT linked_user_id FROM people WHERE id = ?", linked).first()).toEqual({ linked_user_id: null });
  });

  it("needs a recent sign-in", async () => {
    const id = await createOtherUser();
    const old = isoAt(Date.now() - 30 * 60 * 1000);
    const cookie = await sessionCookieFor(id, { createdAt: old });
    const res = await call("/api/account", { method: "DELETE", cookie });
    expect(res).toEqual({ status: 403, body: { error: "Please confirm it's you, then try again.", reauth: true } });
    expect(await sql("SELECT id FROM users WHERE id = ?", id).first()).not.toBeNull();
  });

  it("can't be done from a recovery-code session", async () => {
    const id = await createOtherUser();
    const cookie = await sessionCookieFor(id, { kind: "recovery" });
    expect((await call("/api/account", { method: "DELETE", cookie })).status).toBe(403);
    expect(await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first()).not.toBeNull();
  });

  it("is refused from another site", async () => {
    const id = await createOtherUser();
    const cookie = await sessionCookieFor(id);
    expect((await call("/api/account", { method: "DELETE", cookie, origin: "https://evil.example" })).status).toBe(403);
    expect(await sql("SELECT id FROM users WHERE id = ?", id).first()).not.toBeNull();
  });
});
