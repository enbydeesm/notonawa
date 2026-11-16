// Format v3 files (src/files/): uploading sealed photos and videos, reading
// their parts back, listing and deleting them, the quota, and the daily
// sweep keeping the ones with rows.
import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";
import { ORIGIN, call, createOtherUser, sessionCookieFor, signedInUser, sql } from "../helpers.js";
import { MAX_ACCOUNT_BYTES } from "../../src/media/parse.js";
import { roomLeft } from "../../src/files/parse.js";
import { fileObjectKey } from "../../src/files/storage.js";

const DAY = 24 * 60 * 60 * 1000;

/** A format 2 account and its session. */
async function v2User() {
  const id = await createOtherUser();
  await sql("UPDATE users SET format = 2 WHERE id = ?", id).run();
  return { id, cookie: await sessionCookieFor(id) };
}

/**
 * Uploads a sealed file: a thumbnail of `thumb` bytes of 1s, then `full` of 2s.
 * @param {string} cookie
 * @param {{ id?: string, thumb?: number, full?: number, kind?: string, thumbBytes?: number }} [options]
 */
async function upload(cookie, { id = crypto.randomUUID(), thumb = 10, full = 30, kind = "photo", thumbBytes = thumb } = {}) {
  const body = new Uint8Array(thumb + full);
  body.fill(1, 0, thumb);
  body.fill(2, thumb);
  const res = await SELF.fetch(`${ORIGIN}/api/files/${id}?kind=${kind}&thumb_bytes=${thumbBytes}`, {
    method: "PUT", headers: { cookie, origin: ORIGIN }, body,
  });
  const text = await res.text();
  return { id, status: res.status, body: text ? JSON.parse(text) : null };
}

/**
 * @param {string} cookie
 * @param {string} id
 * @param {"thumb" | "full"} part
 */
async function part(cookie, id, part) {
  const res = await SELF.fetch(`${ORIGIN}/api/files/${id}/${part}`, { headers: { cookie } });
  return { status: res.status, bytes: [...new Uint8Array(await res.arrayBuffer())] };
}

describe("uploading a file", () => {
  it("stores it whole and gives back each part", async () => {
    const { id: owner, cookie } = await v2User();
    const { id, status } = await upload(cookie, { thumb: 3, full: 5 });
    expect(status).toBe(201);
    expect(await part(cookie, id, "thumb")).toEqual({ status: 200, bytes: [1, 1, 1] });
    expect(await part(cookie, id, "full")).toEqual({ status: 200, bytes: [2, 2, 2, 2, 2] });
    expect(await env.PHOTOS.head(fileObjectKey(owner, id))).not.toBeNull();
    expect(await sql("SELECT kind, thumb_bytes, bytes FROM files WHERE id = ?", id).first()).toEqual({ kind: "photo", thumb_bytes: 3, bytes: 8 });
  });

  it("refuses an id already used, a bad kind or thumbnail size, or one too big", async () => {
    const { cookie } = await v2User();
    const { id } = await upload(cookie);
    expect((await upload(cookie, { id })).status).toBe(409);
    expect((await upload(cookie, { kind: "gif" })).status).toBe(400);
    expect((await upload(cookie, { thumbBytes: 0 })).status).toBe(400);
    expect((await upload(cookie, { thumbBytes: 40 })).status).toBe(400);
    expect((await upload(cookie, { thumb: 10, full: 10 * 1024 * 1024 })).status).toBe(400);
  });

  it("refuses one past the account's 1 GB, records and files counted", async () => {
    const { id: owner, cookie } = await v2User();
    await sql("INSERT INTO files (id, owner_id, kind, thumb_bytes, bytes) VALUES (?, ?, 'photo', 0, ?)", crypto.randomUUID(), owner, MAX_ACCOUNT_BYTES - 30)
      .run();
    const res = await upload(cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1 GB/);
    expect(await env.PHOTOS.head(fileObjectKey(owner, res.id))).toBeNull();
  });

  it("while converting, doesn't count the format 1 photos it's replacing", () => {
    const used = { accountBytes: MAX_ACCOUNT_BYTES, mediaBytes: 300 };
    expect(roomLeft({ ...used, converting: false })).toBe(0);
    expect(roomLeft({ ...used, converting: true })).toBe(300);
  });
});

describe("other accounts' files", () => {
  it("can't be read, listed or deleted", async () => {
    const me = await v2User();
    const other = await v2User();
    const { id } = await upload(other.cookie);
    expect((await part(me.cookie, id, "thumb")).status).toBe(404);
    expect((await call("/api/files", { cookie: me.cookie })).body).toEqual([]);
    expect((await call("/api/files/delete", { method: "POST", body: { ids: [id] }, cookie: me.cookie })).body).toEqual({ deleted: [] });
    expect((await part(other.cookie, id, "full")).status).toBe(200);
  });
});

describe("listing and deleting", () => {
  it("lists my files' ids and sizes, and deletes them, objects too", async () => {
    const { id: owner, cookie } = await v2User();
    const a = await upload(cookie, { thumb: 2, full: 3 });
    const b = await upload(cookie);
    const listed = (await call("/api/files", { cookie })).body;
    expect(listed.map((/** @type {any} */ f) => [f.id, f.bytes]).sort()).toEqual([[a.id, 5], [b.id, 40]].sort());
    const res = await call("/api/files/delete", { method: "POST", body: { ids: [a.id, "nope"] }, cookie });
    expect(res.body).toEqual({ deleted: [a.id] });
    expect(await env.PHOTOS.head(fileObjectKey(owner, a.id))).toBeNull();
    expect((await call("/api/files", { cookie })).body.map((/** @type {any} */ f) => f.id)).toEqual([b.id]);
  });

  it("refuses an empty or oversized list", async () => {
    const { cookie } = await v2User();
    for (const body of [{}, { ids: [] }, { ids: Array.from({ length: 1001 }, (_, i) => `f${i}`) }, { ids: ["bad id"] }]) {
      expect((await call("/api/files/delete", { method: "POST", body, cookie })).status).toBe(400);
    }
  });
});

describe("format", () => {
  it("refuses a format 1 account unless it's converting", async () => {
    const { id, cookie } = await signedInUser();
    expect((await call("/api/files")).status).toBe(410);
    expect((await upload(cookie)).status).toBe(410);
    await sql("UPDATE users SET converting_since = '2026-11-14T00:00:00Z' WHERE id = ?", id).run();
    expect((await upload(cookie)).status).toBe(201);
    await sql("UPDATE users SET converting_since = NULL WHERE id = ?", id).run();
  });
});

describe("the daily sweep", () => {
  it("keeps files with a row, and deletes ones without once they're a day old", async () => {
    const { id: owner, cookie } = await v2User();
    const { id } = await upload(cookie);
    const orphan = fileObjectKey(owner, crypto.randomUUID());
    await env.PHOTOS.put(orphan, new Uint8Array([1, 2, 3]));
    const { sweepOrphans } = await import("../../src/media/storage.js");
    expect(await sweepOrphans(env.DB, env.PHOTOS, Date.now())).toBe(0);
    await sweepOrphans(env.DB, env.PHOTOS, Date.now() + 2 * DAY);
    expect(await env.PHOTOS.head(orphan)).toBeNull();
    expect(await env.PHOTOS.head(fileObjectKey(owner, id))).not.toBeNull();
  });
});
