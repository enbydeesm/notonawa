// Identity keys (src/identity/) and mailboxes (src/mailboxes/), format 2:
// a key set once, replaced only with a fresh sign-in; mailboxes written to
// with their token and no session, read and emptied by their owner.
import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { ORIGIN, call, createOtherUser, sessionCookieFor, signedInUser, sql } from "../helpers.js";
import { isoAt } from "../../src/auth/session.js";
import { MAX_WAITING } from "../../src/mailboxes/parse.js";
import { cleanUpMailboxes } from "../../src/mailboxes/cleanup.js";

const chars = (/** @type {number} */ n) => [...crypto.getRandomValues(new Uint8Array(n))]
  .map((b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[b % 64]).join("");
const identity = () => ({ public_key: chars(1622), sealed_seed: `i1.${chars(16)}.${chars(64)}` });
const token = () => chars(43);

/** A format 2 account and its session (an hour old unless fresh). */
async function v2User({ fresh = false } = {}) {
  const id = await createOtherUser();
  await sql("UPDATE users SET format = 2 WHERE id = ?", id).run();
  const signedIn = isoAt(Date.now() - (fresh ? 0 : 60 * 60 * 1000));
  return { id, cookie: await sessionCookieFor(id, { createdAt: signedIn, lastUsedAt: signedIn }) };
}

/**
 * Sends a message as the page does: no cookie at all.
 * @param {string} mailbox
 * @param {Record<string, unknown>} body
 * @param {{ cookie?: string, origin?: string }} [options]
 */
async function send(mailbox, body, { cookie, origin = ORIGIN } = {}) {
  /** @type {Record<string, string>} */
  const headers = { "content-type": "application/json", origin };
  if (cookie) headers.cookie = cookie;
  const res = await SELF.fetch(`${ORIGIN}/api/mailboxes/${mailbox}/messages`, { method: "POST", headers, body: JSON.stringify(body) });
  return res.status;
}

/**
 * @param {string} cookie
 * @param {"intro" | "contact"} [kind]
 */
async function newMailbox(cookie, kind = "contact") {
  const box = { id: chars(22), token: token(), kind };
  const res = await call("/api/mailboxes", { method: "POST", body: box, cookie });
  expect(res.status).toBe(201);
  return { ...box, expires_at: res.body.expires_at };
}

beforeEach(async () => {
  await sql("DELETE FROM mailboxes").run();
});

describe("identity keys", () => {
  it("are set once, then read back", async () => {
    const { cookie } = await v2User();
    expect((await call("/api/identity", { cookie })).status).toBe(404);
    const key = identity();
    expect((await call("/api/identity", { method: "PUT", body: key, cookie })).status).toBe(201);
    expect((await call("/api/identity", { cookie })).body).toMatchObject(key);
  });

  it("are replaced only after a fresh sign-in", async () => {
    const { id } = await v2User();
    const old = await sessionCookieFor(id, { createdAt: isoAt(Date.now() - 3600_000), lastUsedAt: isoAt(Date.now() - 3600_000) });
    await call("/api/identity", { method: "PUT", body: identity(), cookie: old });
    const again = await call("/api/identity", { method: "PUT", body: identity(), cookie: old });
    expect([again.status, again.body.reauth]).toEqual([403, true]);
    const next = identity();
    expect((await call("/api/identity", { method: "PUT", body: next, cookie: await sessionCookieFor(id) })).status).toBe(200);
    expect((await call("/api/identity", { cookie: old })).body.public_key).toBe(next.public_key);
  });

  it("refuse what isn't one", async () => {
    const { cookie } = await v2User();
    for (const bad of [{ ...identity(), public_key: chars(100) }, { ...identity(), sealed_seed: "plain" }, {}]) {
      expect((await call("/api/identity", { method: "PUT", body: bad, cookie })).status).toBe(400);
    }
  });

  it("are format 2's (or converting)", async () => {
    expect((await call("/api/identity")).status).toBe(410);
  });
});

describe("mailboxes", () => {
  it("take a message with their token and no session, and give it to their owner", async () => {
    const me = await v2User();
    const box = await newMailbox(me.cookie);
    expect(await send(box.id, { token: box.token, body: "m1.1.abc.def" })).toBe(204);
    const [message] = (await call("/api/mailboxes/messages", { cookie: me.cookie })).body;
    expect(message).toMatchObject({ mailbox_id: box.id, slot: null, body: "m1.1.abc.def" });
    // Only the token's hash is kept.
    expect(await sql("SELECT token_hash FROM mailboxes WHERE id = ?", box.id).first("token_hash")).not.toBe(box.token);
  });

  it("say the same for a wrong token and no such mailbox", async () => {
    const me = await v2User();
    const box = await newMailbox(me.cookie);
    expect(await send(box.id, { token: token(), body: "m1.1.a.b" })).toBe(404);
    expect(await send(chars(22), { token: box.token, body: "m1.1.a.b" })).toBe(404);
    expect((await call("/api/mailboxes/messages", { cookie: me.cookie })).body).toEqual([]);
  });

  it("ignore the sender's session: the message isn't tied to them", async () => {
    const me = await v2User();
    const sender = await v2User();
    const box = await newMailbox(me.cookie);
    expect(await send(box.id, { token: box.token, body: "m1.1.a.b" }, { cookie: sender.cookie })).toBe(204);
    expect(await sql("SELECT * FROM mailbox_messages").first()).not.toHaveProperty("sender");
  });

  it("still need the app's origin", async () => {
    const box = await newMailbox((await v2User()).cookie);
    expect(await send(box.id, { token: box.token, body: "m1.1.a.b" }, { origin: "https://evil.example" })).toBe(403);
  });

  it("keep only the newest profile message waiting", async () => {
    const me = await v2User();
    const box = await newMailbox(me.cookie);
    await send(box.id, { token: box.token, slot: "profile", body: "m1.1.old.x" });
    await send(box.id, { token: box.token, body: "m1.2.other.x" });
    await send(box.id, { token: box.token, slot: "profile", body: "m1.3.new.x" });
    const bodies = (await call("/api/mailboxes/messages", { cookie: me.cookie })).body.map((/** @type {any} */ m) => m.body);
    expect(bodies.sort()).toEqual(["m1.2.other.x", "m1.3.new.x"]);
  });

  it("hold at most 100 waiting", async () => {
    const me = await v2User();
    const box = await newMailbox(me.cookie);
    await env.DB.batch(Array.from({ length: MAX_WAITING }, (_, i) => env.DB.prepare(
      "INSERT INTO mailbox_messages (id, mailbox_id, body, bytes, expires_at) VALUES (?, ?, 'm', 1, '2999-01-01T00:00:00Z')",
    ).bind(`w${i}`, box.id)));
    expect(await send(box.id, { token: box.token, body: "m1.1.a.b" })).toBe(429);
  });

  it("delete messages acknowledged, only their owner's", async () => {
    const me = await v2User();
    const other = await v2User();
    const box = await newMailbox(me.cookie);
    await send(box.id, { token: box.token, body: "m1.1.a.b" });
    const [message] = (await call("/api/mailboxes/messages", { cookie: me.cookie })).body;
    expect((await call("/api/mailboxes/messages/ack", { method: "POST", body: { ids: [message.id] }, cookie: other.cookie })).body).toEqual({ deleted: 0 });
    expect((await call("/api/mailboxes/messages/ack", { method: "POST", body: { ids: [message.id] }, cookie: me.cookie })).body).toEqual({ deleted: 1 });
    expect((await call("/api/mailboxes/messages", { cookie: me.cookie })).body).toEqual([]);
  });

  it("are deleted by their owner only, messages with them; then sending fails", async () => {
    const me = await v2User();
    const other = await v2User();
    const box = await newMailbox(me.cookie);
    await send(box.id, { token: box.token, body: "m1.1.a.b" });
    expect((await call(`/api/mailboxes/${box.id}`, { method: "DELETE", cookie: other.cookie })).status).toBe(404);
    expect((await call(`/api/mailboxes/${box.id}`, { method: "DELETE", cookie: me.cookie })).status).toBe(204);
    expect(await sql("SELECT COUNT(*) AS n FROM mailbox_messages").first("n")).toBe(0);
    expect(await send(box.id, { token: box.token, body: "m1.2.a.b" })).toBe(404);
  });

  it("an invite's intro lasts a day; then it's closed, and the daily job deletes it", async () => {
    const me = await v2User();
    const intro = await newMailbox(me.cookie, "intro");
    expect(Date.parse(intro.expires_at) - Date.now()).toBeGreaterThan(23 * 3600_000);
    await sql("UPDATE mailboxes SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?", intro.id).run();
    expect(await send(intro.id, { token: intro.token, body: "abc" })).toBe(404);
    expect(await cleanUpMailboxes(env.DB)).toEqual({ mailboxes: 1, messages: 0 });
  });

  it("the daily job deletes messages unfetched for 90 days", async () => {
    const me = await v2User();
    const box = await newMailbox(me.cookie);
    await send(box.id, { token: box.token, body: "m1.1.a.b" });
    await sql("UPDATE mailbox_messages SET expires_at = '2000-01-01T00:00:00Z'").run();
    expect(await cleanUpMailboxes(env.DB)).toEqual({ mailboxes: 0, messages: 1 });
  });

  it("refuse what isn't sealed, a bad token, or a bad kind", async () => {
    const me = await v2User();
    const box = await newMailbox(me.cookie);
    expect(await send(box.id, { token: box.token, body: "has spaces in it" })).toBe(400);
    expect(await send(box.id, { token: "short", body: "m1.1.a.b" })).toBe(400);
    expect((await call("/api/mailboxes", { method: "POST", body: { id: chars(22), token: token(), kind: "other" }, cookie: me.cookie })).status).toBe(400);
  });

  it("are format 2's", async () => {
    await signedInUser();
    expect((await call("/api/mailboxes/messages")).status).toBe(410);
  });
});
