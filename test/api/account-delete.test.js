import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { call, createOtherUser, sessionCookieFor, sql } from "../helpers.js";
import { ORPHANS, countRows, userWithEverything } from "../seed-everything.js";
import { isoAt } from "../../src/auth/session.js";

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

  it("leaves other users' journals alone, clearing only their links to me and our connection", async () => {
    const user = await userWithEverything();
    const other = await userWithEverything();
    const linked = crypto.randomUUID();
    await sql("INSERT INTO people (id, owner_id, name, linked_user_id) VALUES (?, ?, 'Them', ?)", linked, other.id, user.id).run();
    // Connected to each other, on Them.
    const theirs = crypto.randomUUID();
    await sql("INSERT INTO connections (id, owner_id, peer_id, invited) VALUES (?, ?, ?, 1), (?, ?, ?, 0)",
      theirs, other.id, user.id, crypto.randomUUID(), user.id, other.id).run();
    await sql("UPDATE people SET connection_id = ? WHERE id = ?", theirs, linked).run();
    const before = await countRows(other.id);

    await call("/api/account", { method: "DELETE", cookie: user.cookie });
    // Their connection to me is gone (both sides: 2 rows); the rest is theirs as it was.
    expect(await countRows(other.id)).toEqual({ ...before, connections: before.connections - 2 });
    expect(await sql("SELECT linked_user_id, connection_id FROM people WHERE id = ?", linked).first())
      .toEqual({ linked_user_id: null, connection_id: null });
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
