import { describe, it, expect } from "vitest";
import { env, createScheduledController } from "cloudflare:test";
import worker from "../../src/index.js";
import { call, createOtherUser, sessionCookieFor, signedInUser, sql, sealed, fakeWrap } from "../helpers.js";
import { newShareId } from "../../public/js/crypto/share.js";
import { toBase64url, snapshotKey, MAX_LIVE_SHARES } from "../../src/shares/parse.js";
import { MAX_ACCOUNT_BYTES } from "../../src/media/parse.js";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Bytes standing in for a sealed snapshot (the server can't tell them from
 * real ciphertext).
 * @param {number} [bytes]
 */
const snapshotBytes = (bytes = 64) => crypto.getRandomValues(new Uint8Array(bytes));

/** Someone else, signed in. */
async function otherUser() {
  const id = await createOtherUser();
  return { id, cookie: await sessionCookieFor(id) };
}

/**
 * Makes a share as the signed-in user (or with cookie).
 * @param {Record<string, unknown>} [change]
 * @param {string} [cookie]
 */
async function share(change = {}, cookie) {
  const bytes = /** @type {Uint8Array | undefined} */ (change.bytes) ?? snapshotBytes();
  const { bytes: _bytes, ...rest } = change;
  const body = { id: newShareId(), kind: "tie", label: sealed("For Sam"), link_key: sealed("key"), expires: "1d", max_uses: 1, snapshot: toBase64url(bytes), ...rest };
  const res = await call("/api/shares", { method: "POST", body, cookie });
  return { id: /** @type {string} */ (body.id), bytes, res };
}

/**
 * @param {string} id
 * @param {string | null} [cookie] null: signed out
 */
const open = (id, cookie) => call("/api/shares/open", { method: "POST", body: { id }, cookie });

const fromBase64url = (/** @type {string} */ text) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

describe("making a share", () => {
  it("stores the sealed snapshot in my folder and lists it, newest first", async () => {
    const me = await signedInUser();
    const first = await share({ max_uses: null, expires: "never" });
    const second = await share({ kind: "plan" });
    expect(first.res).toEqual({ status: 201, body: { id: first.id } });
    const object = await env.PHOTOS.get(snapshotKey(me.id, first.id));
    expect(new Uint8Array(await /** @type {R2ObjectBody} */ (object).arrayBuffer())).toEqual(first.bytes);

    const list = (await call("/api/shares")).body;
    expect(list.map((/** @type {any} */ s) => s.id).slice(0, 2)).toEqual([second.id, first.id]);
    const listed = list.find((/** @type {any} */ s) => s.id === first.id);
    expect(listed).toEqual({
      id: first.id, kind: "tie", label: sealed("For Sam"), link_key: sealed("key"), bytes: 64, expires_at: null, max_uses: null, use_count: 0,
      created_at: expect.stringMatching(/Z$/),
    });
    // A day from now, as an ISO timestamp.
    const expires = list.find((/** @type {any} */ s) => s.id === second.id).expires_at;
    expect(Math.abs(Date.parse(expires) - Date.now() - DAY)).toBeLessThan(60_000);
  });

  it("refuses an id that's taken, and leaves the first alone", async () => {
    const me = await signedInUser();
    const { id, bytes } = await share();
    const again = await call("/api/shares", { method: "POST", body: {
      id, kind: "tie", label: null, link_key: sealed("key"), expires: "1d", max_uses: 1, snapshot: toBase64url(snapshotBytes()),
    } });
    expect(again.status).toBe(409);
    const object = await env.PHOTOS.get(snapshotKey(me.id, id));
    expect(new Uint8Array(await /** @type {R2ObjectBody} */ (object).arrayBuffer())).toEqual(bytes);
  });

  it("stops at 50 live shares, not counting expired ones", async () => {
    const user = await otherUser();
    for (let i = 0; i < MAX_LIVE_SHARES - 1; i++) {
      await sql("INSERT INTO shares (id, owner_id, kind, bytes) VALUES (?, ?, 'tie', 1)", newShareId(), user.id).run();
    }
    await sql("INSERT INTO shares (id, owner_id, kind, bytes, expires_at) VALUES (?, ?, 'tie', 1, '2000-01-01T00:00:00Z')",
      newShareId(), user.id).run();
    expect((await share({}, user.cookie)).res.status).toBe(201);
    const over = await share({}, user.cookie);
    expect(over.res).toMatchObject({ status: 400, body: { error: expect.stringContaining("at most 50") } });
    expect(await env.PHOTOS.head(snapshotKey(user.id, over.id))).toBeNull();
  });

  it("counts shares and photos together in the account's 1 GB", async () => {
    const user = await otherUser();
    const tie = (await call("/api/ties", { method: "POST", cookie: user.cookie, body: { tie_type: "floor", tie_date: "2026-10-01" } })).body.id;
    await sql(`INSERT INTO media (id, owner_id, tie_id, kind, mime, position, thumb_bytes, bytes)
               VALUES (?, ?, ?, 'photo', 'image/jpeg', 0, 1, ?)`, crypto.randomUUID(), user.id, tie, MAX_ACCOUNT_BYTES - 100).run();
    expect((await share({ bytes: snapshotBytes(100) }, user.cookie)).res.status).toBe(201);
    const over = await share({ bytes: snapshotBytes(28) }, user.cookie);
    expect(over.res).toMatchObject({ status: 400, body: { error: expect.stringContaining("filled your 1 GB") } });
    // And a photo now can't fit either.
    const res = await fetchPhotoUpload(user.cookie, tie);
    expect(res.status).toBe(400);
  });

  it("only takes a sealed name, and nothing typed goes in the address", async () => {
    expect((await share({ label: "For Sam" })).res.status).toBe(400);
  });
});

/**
 * Uploads a small photo (for the shared quota).
 * @param {string} cookie
 * @param {string} tie
 */
function fetchPhotoUpload(cookie, tie) {
  return call(`/api/media/${crypto.randomUUID()}?tie_id=${tie}&kind=photo&mime=image/jpeg&thumb_bytes=1`, {
    method: "PUT", body: "xx", cookie,
  });
}

describe("opening a share", () => {
  it("gives someone else the sealed snapshot and counts the use; the last use deletes it, file and all", async () => {
    const me = await signedInUser();
    const { id, bytes } = await share({ max_uses: 2 });
    const sam = await otherUser();
    const res = await open(id, sam.cookie);
    expect(res).toEqual({ status: 200, body: { kind: "tie", created_at: expect.any(String), own: false, snapshot: expect.any(String) } });
    expect(fromBase64url(res.body.snapshot)).toEqual(bytes);
    expect(await sql("SELECT use_count FROM shares WHERE id = ?", id).first()).toEqual({ use_count: 1 });

    expect((await open(id, (await otherUser()).cookie)).status).toBe(200);
    expect(await sql("SELECT count(*) AS n FROM shares WHERE id = ?", id).first()).toEqual({ n: 0 });
    expect(await env.PHOTOS.head(snapshotKey(me.id, id))).toBeNull();
    expect(await open(id, sam.cookie)).toEqual({ status: 404, body: { error: "This share has ended or doesn't exist." } });
  });

  it("lets only one of two people take a share with one use left", async () => {
    const { id } = await share({ max_uses: 1 });
    const [a, b] = await Promise.all([otherUser(), otherUser()]);
    const results = await Promise.all([open(id, a.cookie), open(id, b.cookie)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
  });

  it("opens my own without counting a use", async () => {
    const { id } = await share({ max_uses: 1 });
    expect((await open(id)).body).toMatchObject({ own: true });
    expect((await open(id)).body).toMatchObject({ own: true });
    expect(await sql("SELECT use_count FROM shares WHERE id = ?", id).first()).toEqual({ use_count: 0 });
  });

  it("can be opened any number of times when it isn't limited", async () => {
    const { id } = await share({ max_uses: null });
    const sam = await otherUser();
    for (let i = 0; i < 3; i++) expect((await open(id, sam.cookie)).status).toBe(200);
    expect(await sql("SELECT use_count FROM shares WHERE id = ?", id).first()).toEqual({ use_count: 3 });
  });

  it("says the same for an expired share as for one that never was", async () => {
    const { id } = await share({ max_uses: null });
    await sql("UPDATE shares SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?", id).run();
    const sam = await otherUser();
    const expired = await open(id, sam.cookie);
    const never = await open(newShareId(), sam.cookie);
    expect(expired).toEqual(never);
    expect(expired.status).toBe(404);
    // Nor does it count a use, or show in my list.
    expect(await sql("SELECT use_count FROM shares WHERE id = ?", id).first()).toEqual({ use_count: 0 });
    expect((await call("/api/shares")).body.some((/** @type {any} */ s) => s.id === id)).toBe(false);
  });

  it("refuses an id that isn't one, and needs a signed-in person", async () => {
    expect((await call("/api/shares/open", { method: "POST", body: { id: "../x" } })).status).toBe(400);
    const { id } = await share();
    expect((await open(id, null)).status).toBe(401);
  });
});

describe("revoking a share", () => {
  it("deletes it and its file at once; no one can open it after", async () => {
    const me = await signedInUser();
    const { id } = await share({ max_uses: null });
    expect((await call(`/api/shares/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(await env.PHOTOS.head(snapshotKey(me.id, id))).toBeNull();
    expect((await open(id, (await otherUser()).cookie)).status).toBe(404);
    expect((await call(`/api/shares/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("can't revoke someone else's", async () => {
    const sam = await otherUser();
    const { id } = await share({}, sam.cookie);
    expect((await call(`/api/shares/${id}`, { method: "DELETE" })).status).toBe(404);
    expect(await env.PHOTOS.head(snapshotKey(sam.id, id))).not.toBeNull();
  });
});

describe("shares are deleted", () => {
  it("with the account, files too", async () => {
    const sam = await otherUser();
    const { id } = await share({}, sam.cookie);
    expect((await call("/api/account", { method: "DELETE", cookie: sam.cookie })).status).toBe(200);
    expect(await sql("SELECT count(*) AS n FROM shares WHERE owner_id = ?", sam.id).first()).toEqual({ n: 0 });
    expect(await env.PHOTOS.head(snapshotKey(sam.id, id))).toBeNull();
  });

  it("on starting a new key, as their names couldn't be opened", async () => {
    const sam = await otherUser();
    const { id } = await share({}, sam.cookie);
    const { loginSecret, newRecoveryCode, readRecoveryCode } = await import("../../public/js/recovery.js");
    const secret = await loginSecret(/** @type {string} */ (readRecoveryCode(newRecoveryCode())));
    const res = await call("/api/keys/setup", { method: "POST", cookie: sam.cookie,
      body: { recovery_secret: secret, recovery_wrap: fakeWrap("recovery"), replace: true } });
    expect(res.status).toBe(204);
    expect(await sql("SELECT count(*) AS n FROM shares WHERE owner_id = ?", sam.id).first()).toEqual({ n: 0 });
    expect(await env.PHOTOS.head(snapshotKey(sam.id, id))).toBeNull();
  });

  it("by the daily clean-up once expired, files too, leaving live ones", async () => {
    const me = await signedInUser();
    const expired = await share({ max_uses: null });
    const live = await share({ max_uses: null });
    await sql("UPDATE shares SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?", expired.id).run();
    await worker.scheduled(createScheduledController(), env);
    expect(await sql("SELECT id FROM shares WHERE id IN (?, ?)", expired.id, live.id).all()).toMatchObject({ results: [{ id: live.id }] });
    expect(await env.PHOTOS.head(snapshotKey(me.id, expired.id))).toBeNull();
    expect(await env.PHOTOS.head(snapshotKey(me.id, live.id))).not.toBeNull();
  });
});

describe("the daily sweep of files without a row", () => {
  it("keeps live shares' files, and deletes a share's file whose row is gone", async () => {
    const me = await signedInUser();
    const live = await share({ max_uses: null });
    const orphan = snapshotKey(me.id, newShareId());
    await env.PHOTOS.put(orphan, new Uint8Array([1, 2, 3]));
    const { sweepOrphans } = await import("../../src/media/storage.js");
    await sweepOrphans(env.DB, env.PHOTOS, Date.now() + 2 * DAY);
    expect(await env.PHOTOS.head(orphan)).toBeNull();
    expect(await env.PHOTOS.head(snapshotKey(me.id, live.id))).not.toBeNull();
  });
});

describe("the export", () => {
  it("lists my shares with their sealed names, not their snapshots", async () => {
    await share({ kind: "workshop", max_uses: null, expires: "never" });
    const doc = (await call("/api/data/export")).body;
    expect(doc.account.shares).toContainEqual({
      kind: "workshop", label: sealed("For Sam"), expires_at: null, max_uses: null, use_count: 0, created_at: expect.any(String),
    });
    // Nor their link keys: those open them, so they stay with the account.
    expect(JSON.stringify(doc.account.shares)).not.toContain("snapshot");
    expect(JSON.stringify(doc.account.shares)).not.toContain("link_key");
  });
});
