// Sealed records (format 2): GET /api/sync and POST /api/records. The
// server stores and returns what it's given; these check versions, sequence
// numbers, deletion markers, the all-or-nothing batch and the quota.
import { describe, it, expect, beforeEach } from "vitest";
import { call, createOtherUser, sessionCookieFor, signedInUser, sql } from "../helpers.js";
import { MAX_BATCH, KINDS, pageCut } from "../../src/records/parse.js";
import { RECORD_KINDS } from "../../public/js/crypto/records.js";

const chars = (/** @type {number} */ n) => [...crypto.getRandomValues(new Uint8Array(n))]
  .map((b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[b % 64]).join("");
/** A sealed item key's shape. */
const key = () => `k2.${chars(16)}.${chars(64)}`;
/** A sealed body's shape (the server can't tell one that opens). */
const body = (/** @type {number} */ length = 400) => `e2.${chars(16)}.${chars(length)}`;

// Each test starts with none: ids are global, and the file's tests share
// one database.
beforeEach(async () => {
  await sql("DELETE FROM records").run();
  await sql("DELETE FROM record_deletions").run();
  await sql("DELETE FROM files").run();
});

/** A format 2 account and its session. */
async function v2User() {
  const id = await createOtherUser();
  await sql("UPDATE users SET format = 2 WHERE id = ?", id).run();
  return { id, cookie: await sessionCookieFor(id) };
}

/**
 * @param {string} cookie
 * @param {{ writes?: any[], deletes?: any[] }} batch
 */
const save = (cookie, batch) => call("/api/records", { method: "POST", body: batch, cookie });
/**
 * @param {string} cookie
 * @param {number} [since]
 */
const sync = (cookie, since = 0) => call(`/api/sync?since=${since}`, { cookie });
/** @param {string} id @param {number} [base] */
const write = (id, base = 0, kind = "tie") => ({ id, kind, base_version: base, key: key(), body: body() });

describe("writing records", () => {
  it("saves new ones at version 1, each with the next sequence number", async () => {
    const { cookie } = await v2User();
    const res = await save(cookie, { writes: [write("a"), write("b")] });
    expect(res.status).toBe(200);
    expect(res.body.saved).toEqual([{ id: "a", version: 1, seq: 1 }, { id: "b", version: 1, seq: 2 }]);
    const again = await save(cookie, { writes: [write("c")] });
    expect(again.body.saved).toEqual([{ id: "c", version: 1, seq: 3 }]);
  });

  it("saves a change on the version it was based on, and refuses a stale one: the whole batch", async () => {
    const { cookie } = await v2User();
    await save(cookie, { writes: [write("a"), write("b")] });
    expect((await save(cookie, { writes: [write("a", 1)] })).body.saved).toEqual([{ id: "a", version: 2, seq: 3 }]);
    // b is fine, a is stale (another device saved version 2 first): neither is saved.
    const stale = await save(cookie, { writes: [write("b", 1), write("a", 1)] });
    expect(stale.status).toBe(409);
    expect(stale.body.stale).toEqual(["a"]);
    const { changes } = (await sync(cookie)).body;
    expect(changes.map((/** @type {any} */ c) => [c.id, c.version])).toEqual([["b", 1], ["a", 2]]);
  });

  it("refuses a new record whose id is taken, by me or anyone", async () => {
    const me = await v2User();
    const other = await v2User();
    await save(other.cookie, { writes: [write("theirs")] });
    await save(me.cookie, { writes: [write("mine")] });
    for (const id of ["mine", "theirs"]) {
      const res = await save(me.cookie, { writes: [write(id)] });
      expect([res.status, res.body.stale]).toEqual([409, [id]]);
    }
  });

  it("can't change or delete someone else's record, or change a record's kind", async () => {
    const me = await v2User();
    const other = await v2User();
    await save(other.cookie, { writes: [write("theirs")] });
    expect((await save(me.cookie, { writes: [write("theirs", 1)] })).status).toBe(409);
    expect((await save(me.cookie, { deletes: [{ id: "theirs", kind: "tie", base_version: 1 }] })).status).toBe(409);
    await save(me.cookie, { writes: [write("mine")] });
    expect((await save(me.cookie, { writes: [write("mine", 1, "plan")] })).body.stale).toEqual(["mine"]);
    expect((await sync(other.cookie)).body.changes[0].version).toBe(1);
  });

  it("deletes leave a marker, free their files, and the id can't come back", async () => {
    const { id, cookie } = await v2User();
    await sql("INSERT INTO files (id, owner_id, kind, thumb_bytes, bytes) VALUES ('f1', ?1, 'photo', 10, 100)", id).run();
    await save(cookie, { writes: [write("a")] });
    const del = await save(cookie, { deletes: [{ id: "a", kind: "tie", base_version: 1, files: ["f1", "not-mine"] }] });
    expect(del.body.saved).toEqual([{ id: "a", version: null, seq: 2 }]);
    expect(await sql("SELECT COUNT(*) AS n FROM files WHERE owner_id = ?", id).first("n")).toBe(0);
    expect((await sync(cookie)).body.changes).toEqual([{ id: "a", kind: "tie", seq: 2, deleted: true, version: null, key: null, body: null }]);
    expect((await save(cookie, { writes: [write("a")] })).status).toBe(409);
  });

  it("refuses a delete of a version that isn't the record's now", async () => {
    const { cookie } = await v2User();
    await save(cookie, { writes: [write("a")] });
    await save(cookie, { writes: [write("a", 1)] });
    expect((await save(cookie, { deletes: [{ id: "a", kind: "tie", base_version: 1 }] })).body.stale).toEqual(["a"]);
  });

  it("refuses what isn't sealed, a batch too big, an id twice, or an unknown kind", async () => {
    const { cookie } = await v2User();
    for (const bad of [
      { writes: [{ ...write("a"), body: "plain text" }] },
      { writes: [{ ...write("a"), key: "k2.short" }] },
      { writes: [{ ...write("a"), body: body(100) }] },
      { writes: Array.from({ length: MAX_BATCH + 1 }, (_, i) => write(`r${i}`)) },
      { writes: [write("a")], deletes: [{ id: "a", kind: "tie", base_version: 1 }] },
      { writes: [{ ...write("a"), kind: "ties" }] },
      { writes: [{ ...write("a"), id: "has spaces" }] },
      {},
    ]) {
      expect((await save(cookie, bad)).status).toBe(400);
    }
  });

  it("refuses writes once the account is over its 1 GB, but still lets it delete", async () => {
    const { id, cookie } = await v2User();
    await save(cookie, { writes: [write("a")] });
    await sql("INSERT INTO files (id, owner_id, kind, thumb_bytes, bytes) VALUES ('big', ?1, 'photo', 0, ?2)", id, 1024 * 1024 * 1024).run();
    const res = await save(cookie, { writes: [write("b")] });
    expect(res.status).toBe(413);
    expect((await sync(cookie)).body.changes.map((/** @type {any} */ c) => c.id)).toEqual(["a"]);
    expect((await save(cookie, { deletes: [{ id: "a", kind: "tie", base_version: 1 }] })).status).toBe(200);
  });

  it("counts records toward the quota", async () => {
    const { id, cookie } = await v2User();
    await save(cookie, { writes: [write("a")] });
    const bytes = await sql("SELECT bytes FROM records WHERE id = 'a'").first("bytes");
    expect(bytes).toBeGreaterThan(400);
    expect(await sql("SELECT COUNT(*) AS n FROM records WHERE owner_id = ?", id).first("n")).toBe(1);
  });
});

describe("syncing", () => {
  it("gives everything since a sequence number, oldest first, records and deletions alike", async () => {
    const { cookie } = await v2User();
    await save(cookie, { writes: [write("a"), write("b"), write("c")] });
    await save(cookie, { deletes: [{ id: "b", kind: "tie", base_version: 1 }] });
    await save(cookie, { writes: [write("a", 1)] });
    const all = (await sync(cookie)).body;
    expect(all.changes.map((/** @type {any} */ c) => [c.id, c.seq, c.deleted])).toEqual([["c", 3, false], ["b", 4, true], ["a", 5, false]]);
    expect([all.next, all.done]).toEqual([5, true]);
    expect((await sync(cookie, 4)).body.changes.map((/** @type {any} */ c) => c.id)).toEqual(["a"]);
    expect((await sync(cookie, 5)).body).toEqual({ changes: [], next: 5, done: true });
  });

  it("pages by rows: next and done say where to carry on", async () => {
    const { cookie } = await v2User();
    await save(cookie, { writes: ["a", "b", "c"].map((id) => write(id)) });
    const first = (await call("/api/sync?since=0&limit=2", { cookie })).body;
    expect([first.changes.length, first.next, first.done]).toEqual([2, 2, false]);
    const rest = (await call(`/api/sync?since=${first.next}&limit=2`, { cookie })).body;
    expect([rest.changes.map((/** @type {any} */ c) => c.id), rest.done]).toEqual([["c"], true]);
  });

  it("only gives my own", async () => {
    const me = await v2User();
    const other = await v2User();
    await save(other.cookie, { writes: [write("theirs")] });
    expect((await sync(me.cookie)).body.changes).toEqual([]);
  });

  it("refuses a bad since or limit", async () => {
    const { cookie } = await v2User();
    for (const query of ["since=-1", "since=x", "limit=0", "limit=501"]) {
      expect((await call(`/api/sync?${query}`, { cookie })).status).toBe(400);
    }
  });
});

describe("format", () => {
  it("refuses a format 1 account, unless it's converting", async () => {
    const { id } = await signedInUser();
    expect((await call("/api/sync")).status).toBe(410);
    expect((await call("/api/records", { method: "POST", body: { writes: [write("x")] } })).status).toBe(410);
    await sql("UPDATE users SET converting_since = '2026-11-14T00:00:00Z' WHERE id = ?", id).run();
    expect((await call("/api/sync")).status).toBe(200);
    await sql("UPDATE users SET converting_since = NULL WHERE id = ?", id).run();
  });

  it("has the same kinds as the page", () => {
    expect([...KINDS]).toEqual([...RECORD_KINDS]);
  });
});

describe("pageCut", () => {
  it("stops after the row that passes the bytes, always taking one", () => {
    const rows = [100, 100, 100].map((bytes, i) => ({ seq: i + 1, bytes }));
    expect(pageCut(rows, 250)).toBe(2);
    expect(pageCut(rows, 1000)).toBe(3);
    expect(pageCut([{ seq: 1, bytes: 5000 }], 100)).toBe(1);
    expect(pageCut([], 100)).toBe(0);
  });
});
