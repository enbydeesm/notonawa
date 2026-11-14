// Converting an account from format 1 to format 2 (src/convert/), and the
// format gate (src/format.js) as requests meet it: starting, the format 1
// journal frozen meanwhile, and the finish's one batch. Also sign-up's format.
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { call, createOtherUser, sessionCookieFor, sql } from "../helpers.js";
import { ORPHANS, countRows, userWithEverything } from "../seed-everything.js";
import { V1_TABLES } from "../../src/convert/db.js";
import { objectKey } from "../../src/media/storage.js";
import { newUserStatements } from "../../src/auth/db.js";

// What the finish deletes: the format 1 journal, with its child rows.
const JOURNAL = [...V1_TABLES, "profile_notes", "plan_tags", "tie_participants", "tie_plans", "tie_tags", "workshop_people", "workshop_tags"];

/** A format 1 account with nothing in it, and its session. */
async function v1User() {
  const id = await createOtherUser();
  return { id, cookie: await sessionCookieFor(id) };
}

/** @param {string} cookie */
const start = (cookie) => call("/api/convert/start", { method: "POST", cookie });
/** @param {string} cookie */
const finish = (cookie) => call("/api/convert/finish", { method: "POST", cookie });
/** @param {string} id */
const account = (id) => sql("SELECT format, converting_since, converted_at FROM users WHERE id = ?", id).first();
/** @param {string} id */
const addRecord = (id) => sql("INSERT INTO records (id, owner_id, kind, version, seq, key, body, bytes) VALUES (?, ?, 'person', 1, 1, 'k', 'b', 2)",
  crypto.randomUUID(), id).run();

describe("starting", () => {
  it("marks a format 1 account converting, once", async () => {
    const { id, cookie } = await v1User();
    const first = await start(cookie);
    expect(first.status).toBe(200);
    expect(first.body.converting_since).toMatch(/^\d{4}-\d\d-\d\dT/);
    await sql("UPDATE users SET converting_since = '2026-01-01T00:00:00Z' WHERE id = ?", id).run();
    expect((await start(cookie)).body.converting_since).toBe("2026-01-01T00:00:00Z");
  });

  it("is refused once the account is format 2", async () => {
    const { id, cookie } = await v1User();
    await sql("UPDATE users SET format = 2 WHERE id = ?", id).run();
    expect((await start(cookie))).toMatchObject({ status: 409, body: { reload: true } });
    expect((await account(id))?.converting_since).toBeNull();
  });
});

describe("while converting", () => {
  it("the format 1 journal can be read but not changed, and format 2's routes open", async () => {
    const { cookie } = await v1User();
    expect((await call("/api/people", { method: "POST", body: { name: "Sam" }, cookie })).status).toBe(201);
    expect((await call("/api/sync", { cookie })).status).toBe(410);
    await start(cookie);
    const refused = await call("/api/people", { method: "POST", body: { name: "Alex" }, cookie });
    expect(refused).toMatchObject({ status: 409, body: { reload: true } });
    expect((await call("/api/data/export", { cookie })).status).toBe(200);
    expect((await call("/api/ties/search", { method: "POST", body: {}, cookie })).status).toBe(200);
    expect((await call("/api/sync", { cookie })).status).toBe(200);
    // Mailboxes wait for format 2.
    expect((await call("/api/mailboxes/messages", { cookie })).status).toBe(410);
  });
});

describe("finishing", () => {
  it("is refused unless converting, or with no records written", async () => {
    const { id, cookie } = await v1User();
    await call("/api/people", { method: "POST", body: { name: "Sam" }, cookie });
    expect((await finish(cookie)).status).toBe(409);
    await start(cookie);
    expect((await finish(cookie)).status).toBe(409);
    expect(await sql("SELECT COUNT(*) AS n FROM people WHERE owner_id = ?", id).first("n")).toBe(1);
    expect((await account(id))?.format).toBe(1);
  });

  it("makes the account format 2 and deletes its format 1 journal and files, nothing else", async () => {
    const user = await userWithEverything();
    // A format 1 photo's file, and someone else's journal.
    const [{ id: photo }] = /** @type {{ id: string }[]} */ ((await sql("SELECT id FROM media WHERE owner_id = ?", user.id).all()).results);
    await env.PHOTOS.put(objectKey(user.id, photo), new Uint8Array([1, 2]));
    const other = await v1User();
    await call("/api/people", { method: "POST", body: { name: "Kit" }, cookie: other.cookie });
    const before = await countRows(user.id);

    await start(user.cookie);
    expect(await finish(user.cookie)).toEqual({ status: 200, body: { ok: true } });

    const after = await countRows(user.id);
    for (const [table, n] of Object.entries(before)) {
      expect(after[table], table).toBe(JOURNAL.includes(table) ? 0 : n);
    }
    for (const query of ORPHANS) expect((await sql(query).first())?.n, query).toBe(0);
    expect(await account(user.id)).toMatchObject({ format: 2, converting_since: null, converted_at: expect.stringMatching(/T/) });
    expect(await env.PHOTOS.head(objectKey(user.id, photo))).toBeNull();
    expect(await sql("SELECT COUNT(*) AS n FROM people WHERE owner_id = ?", other.id).first("n")).toBe(1);
    // The gate follows: the format 1 journal is gone for good, format 2's open.
    expect((await call("/api/data/export", { cookie: user.cookie })).status).toBe(410);
    expect((await call("/api/sync", { cookie: user.cookie })).status).toBe(200);
    expect((await finish(user.cookie)).status).toBe(409);
  });

  it("keeps the format 2 tables it writes in, even when they're all it has", async () => {
    const { id, cookie } = await v1User();
    await start(cookie);
    await addRecord(id);
    expect((await finish(cookie)).status).toBe(200);
    expect(await sql("SELECT COUNT(*) AS n FROM records WHERE owner_id = ?", id).first("n")).toBe(1);
  });
});

describe("signing up", () => {
  /** @param {1 | 2} format */
  async function signUp(format) {
    const id = crypto.randomUUID();
    const invite = `inv-${id}`;
    await sql("INSERT INTO invites (code_hash) VALUES (?)", invite).run();
    await env.DB.batch(newUserStatements(env.DB, id, invite, `recovery-${id}`, format));
    return id;
  }

  it("a format 1 account starts with its Me", async () => {
    const id = await signUp(1);
    expect((await account(id))?.format).toBe(1);
    expect(await sql("SELECT name, is_self FROM people WHERE owner_id = ?", id).all()).toMatchObject({ results: [{ name: "Me", is_self: 1 }] });
  });

  it("a format 2 account starts with no format 1 rows", async () => {
    const id = await signUp(2);
    expect((await account(id))?.format).toBe(2);
    expect(await sql("SELECT COUNT(*) AS n FROM people WHERE owner_id = ?", id).first("n")).toBe(0);
  });
});
