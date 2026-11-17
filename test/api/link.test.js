// Signing in on a new device with one that's signed in (src/link/).
import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { ORIGIN, call, createOtherUser, sessionCookieFor, sql } from "../helpers.js";
import { isoAt } from "../../src/auth/session.js";
import { cleanUp } from "../../src/cleanup.js";
import { env } from "cloudflare:test";

const PUBLIC_KEY = "P".repeat(1622);
const SEALED = "S".repeat(1558);

/** A new request, as the new device makes it (signed out). */
async function newLink() {
  const res = await call("/api/link", { method: "POST", body: { public_key: PUBLIC_KEY }, cookie: null });
  expect(res.status).toBe(201);
  return /** @type {{ id: string, poll: string, expires_at: string }} */ (res.body);
}

/**
 * The new device asking about it, with the Set-Cookie it gets back.
 * @param {{ id: string, poll: string }} link
 * @param {string | null} [cookie]
 */
async function status(link, cookie = null) {
  const res = await SELF.fetch(`${ORIGIN}/api/link/status`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ id: link.id, poll: link.poll }),
  });
  return { status: res.status, body: await res.json(), setCookie: res.headers.get("set-cookie") };
}

/** A signed-in account approving it. */
async function approve(/** @type {string} */ id, /** @type {string} */ cookie) {
  return call(`/api/link/${id}/approve`, { method: "POST", body: { sealed_key: SEALED }, cookie });
}

describe("signing in on a new device", () => {
  it("waits until approved, then gives the sealed key and a session that can only add a passkey, once", async () => {
    const userId = await createOtherUser();
    const cookie = await sessionCookieFor(userId);
    const link = await newLink();
    expect(link.expires_at > isoAt(Date.now() + 4 * 60 * 1000)).toBe(true);
    expect(await sql("SELECT poll_hash FROM link_requests WHERE id = ?", link.id).first())
      .not.toEqual({ poll_hash: link.poll }); // only its hash is kept

    expect((await status(link)).body).toEqual({ state: "waiting" });
    expect(await call(`/api/link/${link.id}`, { cookie })).toEqual({ status: 200, body: { public_key: PUBLIC_KEY, expires_at: link.expires_at } });
    expect(await approve(link.id, cookie)).toEqual({ status: 200, body: { ok: true } });
    // Approved: no longer offered to approve again.
    expect((await call(`/api/link/${link.id}`, { cookie })).status).toBe(404);
    expect((await approve(link.id, cookie)).status).toBe(404);

    const done = await status(link);
    expect(done.body).toEqual({ state: "approved", user_id: userId, sealed_key: SEALED });
    expect(done.setCookie).toMatch(/^__Host-session=[^;]+; .*Max-Age=900/);
    const newCookie = /** @type {string} */ (done.setCookie).split(";")[0];
    // A session that can read its keys and add a passkey, nothing else.
    expect((await call("/api/keys", { cookie: newCookie })).status).toBe(200);
    expect((await call("/api/account/settings", { cookie: newCookie })).status).toBe(200);
    expect(await call("/api/tags", { cookie: newCookie })).toMatchObject({ status: 403, body: { recovery: true } });
    expect((await call("/api/auth/register/options", { method: "POST", body: {}, cookie: newCookie })).status).toBe(200);
    // Picked up once: gone.
    expect((await status(link)).status).toBe(404);
    expect(await sql("SELECT count(*) AS n FROM link_requests WHERE id = ?", link.id).first()).toEqual({ n: 0 });
  });

  it("only answers the token it was made with", async () => {
    const link = await newLink();
    const res = await status({ id: link.id, poll: "x".repeat(43) });
    expect(res).toMatchObject({ status: 404, body: { error: "This sign-in request has ended. Start again on the new device." } });
    expect(res.setCookie).toBeNull();
  });

  it("ends after 5 minutes: not approvable, not picked up, and cleared by the daily job", async () => {
    const cookie = await sessionCookieFor(await createOtherUser());
    const waiting = await newLink();
    const approved = await newLink();
    await approve(approved.id, cookie);
    await sql("UPDATE link_requests SET expires_at = '2000-01-01T00:00:00Z' WHERE id IN (?, ?)", waiting.id, approved.id).run();
    expect((await call(`/api/link/${waiting.id}`, { cookie })).status).toBe(404);
    expect((await approve(waiting.id, cookie)).status).toBe(404);
    expect((await status(waiting)).status).toBe(404);
    const late = await status(approved);
    expect(late.status).toBe(404);
    expect(late.setCookie).toBeNull();
    await cleanUp(env.DB);
    expect(await sql("SELECT count(*) AS n FROM link_requests WHERE id IN (?, ?)", waiting.id, approved.id).first()).toEqual({ n: 0 });
  });

  it("needs a recent sign-in to approve, and a full session", async () => {
    const userId = await createOtherUser();
    const link = await newLink();
    const stale = await sessionCookieFor(userId, { createdAt: isoAt(Date.now() - 30 * 60 * 1000) });
    expect(await approve(link.id, stale)).toMatchObject({ status: 403, body: { reauth: true } });
    const recovery = await sessionCookieFor(userId, { kind: "recovery" });
    expect(await approve(link.id, recovery)).toMatchObject({ status: 403, body: { recovery: true } });
    expect(await call(`/api/link/${link.id}`, { cookie: null })).toMatchObject({ status: 401 });
    expect((await status(link)).body).toEqual({ state: "waiting" });
  });

  it("checks the sealed key's shape", async () => {
    const cookie = await sessionCookieFor(await createOtherUser());
    const link = await newLink();
    expect((await call(`/api/link/${link.id}/approve`, { method: "POST", body: { sealed_key: "short" }, cookie })).status).toBe(400);
    expect((await call("/api/link", { method: "POST", body: { public_key: "short" }, cookie: null })).status).toBe(400);
  });

  it("declining ends it, waiting or approved, but not someone else's approved one", async () => {
    const me = await sessionCookieFor(await createOtherUser());
    const them = await sessionCookieFor(await createOtherUser());
    const waiting = await newLink();
    expect(await call(`/api/link/${waiting.id}`, { method: "DELETE", cookie: me })).toEqual({ status: 200, body: { ok: true } });
    expect((await status(waiting)).status).toBe(404);

    const theirs = await newLink();
    await approve(theirs.id, them);
    await call(`/api/link/${theirs.id}`, { method: "DELETE", cookie: me });
    expect((await status(theirs)).body.state).toBe("approved");
  });

  it("replaces a session the new device already had", async () => {
    const userId = await createOtherUser();
    const link = await newLink();
    await approve(link.id, await sessionCookieFor(userId));
    const leftover = await sessionCookieFor(await createOtherUser(), { kind: "recovery" });
    const done = await status(link, leftover);
    expect(done.status).toBe(200);
    expect((await call("/api/keys", { cookie: leftover })).status).toBe(401);
  });

  it("is refused from another site", async () => {
    expect((await call("/api/link", { method: "POST", body: { public_key: PUBLIC_KEY }, cookie: null, origin: "https://evil.example" })).status).toBe(403);
  });

  it("goes with the account that approved it", async () => {
    const userId = await createOtherUser();
    const link = await newLink();
    await approve(link.id, await sessionCookieFor(userId));
    await sql("DELETE FROM users WHERE id = ?", userId).run();
    expect(await sql("SELECT count(*) AS n FROM link_requests WHERE id = ?", link.id).first()).toEqual({ n: 0 });
  });
});
