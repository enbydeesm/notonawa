// The empty-account script's SQL (scripts/mark-empty-lib.mjs): accounts
// with nothing in their journal are made format 2, every other kind of
// content keeps an account format 1 (to convert), and once marked,
// format 1's routes refuse it, so nothing can slip in between.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { call, createOtherUser, sessionCookieFor, sql } from "../helpers.js";
import { COUNT_SQL, MARK_SQL, DELETE_ME_SQL } from "../../scripts/mark-empty-lib.mjs";

/** A format 1 account with its "Me", as sign-up makes it, and a session. */
async function account() {
  const id = await createOtherUser();
  const me = crypto.randomUUID();
  await sql("INSERT INTO people (id, owner_id, name, is_self) VALUES (?, ?, 'Me', 1)", me, id).run();
  return { id, me, cookie: await sessionCookieFor(id) };
}

/** @param {string} id */
const formatOf = async (id) => sql("SELECT format, converted_at FROM users WHERE id = ?", id).first();

beforeEach(async () => {
  // Only this test's accounts: every account made before is marked format 2 out of the way.
  await sql("UPDATE users SET format = 2").run();
});

describe("marking empty accounts", () => {
  it("makes an empty account format 2 and deletes its plain Me; leaves one with anything in it", async () => {
    const empty = await account();
    /** @type {Record<string, (a: Awaited<ReturnType<typeof account>>) => Promise<unknown>>} */
    const content = {
      tie: (a) => sql("INSERT INTO ties (id, owner_id, tie_date, tie_type) VALUES (?, ?, '2026-01-01', 'floor')", crypto.randomUUID(), a.id).run(),
      plan: (a) => sql("INSERT INTO plans (id, owner_id, title) VALUES (?, ?, 'TK')", crypto.randomUUID(), a.id).run(),
      location: (a) => sql("INSERT INTO locations (id, owner_id, name) VALUES (?, ?, 'Studio')", crypto.randomUUID(), a.id).run(),
      tag: (a) => sql("INSERT INTO tags (id, owner_id, name) VALUES (?, ?, 'box')", crypto.randomUUID(), a.id).run(),
      person: (a) => sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Sam')", crypto.randomUUID(), a.id).run(),
      "Me renamed": (a) => sql("UPDATE people SET name = 'Jude' WHERE id = ?", a.me).run(),
      "Me with notes": (a) => sql("UPDATE people SET notes = 'e1.x.y' WHERE id = ?", a.me).run(),
      "a profile note": (a) => sql("INSERT INTO profile_notes (id, person_id, type, description) VALUES (?, ?, 'like', 'e1.x.y')",
        crypto.randomUUID(), a.me).run(),
      "role names": (a) => sql("UPDATE users SET top_label = 'Rigger' WHERE id = ?", a.id).run(),
      "a default body": (a) => sql("UPDATE users SET default_shape = '[50,50,50,170]' WHERE id = ?", a.id).run(),
      "a preset": (a) => sql("INSERT INTO pose_presets (id, owner_id, kind, name, data) VALUES (?, ?, 'arms', 'e1.x.y', '{}')",
        crypto.randomUUID(), a.id).run(),
      converting: (a) => sql("UPDATE users SET converting_since = '2026-11-14T00:00:00Z' WHERE id = ?", a.id).run(),
    };
    const kept = [];
    for (const [what, add] of Object.entries(content)) {
      const a = await account();
      await add(a);
      kept.push([what, a.id]);
    }
    expect(await sql(COUNT_SQL).first("n")).toBe(1);
    const { results } = await env.DB.prepare(MARK_SQL).all();
    await env.DB.prepare(DELETE_ME_SQL).run();
    expect(results.map((r) => r.id)).toEqual([empty.id]);
    expect(await formatOf(empty.id)).toMatchObject({ format: 2, converted_at: expect.stringMatching(/T/) });
    expect(await sql("SELECT COUNT(*) AS n FROM people WHERE owner_id = ?", empty.id).first("n")).toBe(0);
    for (const [what, id] of kept) expect((await formatOf(id))?.format, what).toBe(1);
  });

  it("is safe to run again, and an account that gains a tie after it's marked is refused, not lost", async () => {
    const a = await account();
    await env.DB.prepare(MARK_SQL).run();
    await env.DB.prepare(DELETE_ME_SQL).run();
    expect((await env.DB.prepare(MARK_SQL).all()).results).toEqual([]);
    // An old open page saving a tie: format 1's routes refuse a format 2 account.
    const res = await call("/api/ties", { method: "POST", body: { tie_date: "2026-01-01", tie_type: "floor" }, cookie: a.cookie });
    expect([res.status, res.body.reload]).toEqual([410, true]);
    expect(await sql("SELECT COUNT(*) AS n FROM ties WHERE owner_id = ?", a.id).first("n")).toBe(0);
  });

  it("an account that gains a tie before the update is seen with it, and left to convert", async () => {
    const a = await account();
    await call("/api/ties", { method: "POST", body: { tie_date: "2026-01-01", tie_type: "floor" }, cookie: a.cookie });
    expect((await env.DB.prepare(MARK_SQL).all()).results).toEqual([]);
    expect((await formatOf(a.id))?.format).toBe(1);
  });
});
