// Push notifications (src/push/): this device's subscription, and sending
// to the push services, faked here (a device's keys made in the test, so
// what's sent is opened and read back).
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { call, createOtherUser, sessionCookieFor, sql } from "../helpers.js";
import { notifyMailboxOwner, pushNotices, NOTICE_BATCH } from "../../src/push/send.js";
import { toBase64url } from "../../src/push/webpush.js";

const enc = (/** @type {string} */ t) => new TextEncoder().encode(t);

/** A device: its push keys, as a browser makes them, and a way to open what's sent to it. */
async function newDevice(host = "web.push.apple.com") {
  const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const publicKey = new Uint8Array(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey("raw", pair.publicKey)));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const endpoint = `https://${host}/${crypto.randomUUID()}`;
  /** @param {Uint8Array} body */
  async function open(body) {
    const salt = body.subarray(0, 16);
    const serverPublic = body.subarray(21, 21 + body[20]);
    const serverKey = await crypto.subtle.importKey("raw", serverPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits(/** @type {any} */ ({ name: "ECDH", public: serverKey }), pair.privateKey, 256));
    /** @param {Uint8Array} s @param {Uint8Array} ikm @param {Uint8Array} info @param {number} n */
    const hkdf = async (s, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info },
      await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
    const info = new Uint8Array([...enc("WebPush: info\0"), ...publicKey, ...serverPublic]);
    const ikm = await hkdf(auth, shared, info, 32);
    const cek = await crypto.subtle.importKey("raw", await hkdf(salt, ikm, enc("Content-Encoding: aes128gcm\0"), 16), "AES-GCM", false, ["decrypt"]);
    const nonce = await hkdf(salt, ikm, enc("Content-Encoding: nonce\0"), 12);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cek, body.subarray(21 + body[20])));
    expect(plain.at(-1)).toBe(2);
    return JSON.parse(new TextDecoder().decode(plain.subarray(0, -1)));
  }
  return { subscription: { endpoint, keys: { p256dh: toBase64url(publicKey), auth: toBase64url(auth) } }, open };
}

/**
 * A fake push service: records each push, answering with the status given for its address (201 otherwise).
 * @param {Record<string, number>} [statuses]
 */
function pushService(statuses = {}) {
  /** @type {{ url: string, headers: Record<string, string>, body: Uint8Array }[]} */
  const sent = [];
  /** @param {string} url @param {RequestInit} init */
  const fetcher = async (url, init) => {
    sent.push({ url, headers: /** @type {Record<string, string>} */ (init.headers), body: new Uint8Array(/** @type {Uint8Array} */ (init.body)) });
    return new Response(null, { status: statuses[url] ?? 201 });
  };
  return { sent, fetcher };
}

async function signedIn() {
  const id = await createOtherUser();
  return { id, cookie: await sessionCookieFor(id) };
}

/** @param {string} cookie @param {any} subscription @param {{ connections?: boolean, announcements?: boolean }} [kinds] */
const subscribe = (cookie, subscription, { connections = true, announcements = true } = {}) =>
  call("/api/push/subscription", { method: "POST", body: { ...subscription, connections, announcements }, cookie });

describe("this device's notifications", () => {
  it("gives the public key to subscribe with", async () => {
    const { cookie } = await signedIn();
    expect(await call("/api/push", { cookie })).toEqual({ status: 200, body: { public_key: env.VAPID_PUBLIC_KEY } });
    expect((await call("/api/push", { cookie: null })).status).toBe(401);
  });

  it("subscribes, says which kinds, changes them, and turns off", async () => {
    const { cookie } = await signedIn();
    const { subscription } = await newDevice();
    const status = () => call("/api/push/subscription/status", { method: "POST", body: { endpoint: subscription.endpoint }, cookie });
    expect((await status()).body).toEqual({ subscribed: false, connections: false, announcements: false });
    expect(await subscribe(cookie, subscription)).toEqual({ status: 200, body: { ok: true } });
    expect((await status()).body).toEqual({ subscribed: true, connections: true, announcements: true });
    await subscribe(cookie, subscription, { announcements: false });
    expect((await status()).body).toEqual({ subscribed: true, connections: true, announcements: false });
    expect(await sql("SELECT count(*) AS n FROM push_subscriptions WHERE endpoint = ?", subscription.endpoint).first()).toEqual({ n: 1 });
    await call("/api/push/subscription/delete", { method: "POST", body: { endpoint: subscription.endpoint }, cookie });
    expect((await status()).body.subscribed).toBe(false);
  });

  it("moves a device to whoever subscribes on it, and only its own account can see or delete it", async () => {
    const a = await signedIn();
    const b = await signedIn();
    const { subscription } = await newDevice();
    await subscribe(a.cookie, subscription);
    // B can't remove A's.
    await call("/api/push/subscription/delete", { method: "POST", body: { endpoint: subscription.endpoint }, cookie: b.cookie });
    expect(await sql("SELECT user_id FROM push_subscriptions WHERE endpoint = ?", subscription.endpoint).first()).toEqual({ user_id: a.id });
    expect((await call("/api/push/subscription/status", { method: "POST", body: { endpoint: subscription.endpoint }, cookie: b.cookie })).body.subscribed)
      .toBe(false);
    // B signs in on that device and turns them on: it's B's now.
    await subscribe(b.cookie, subscription);
    expect(await sql("SELECT user_id FROM push_subscriptions WHERE endpoint = ?", subscription.endpoint).all())
      .toMatchObject({ results: [{ user_id: b.id }] });
  });

  it("refuses an address that isn't a push service's, and wrong keys", async () => {
    const { cookie } = await signedIn();
    const { subscription } = await newDevice();
    expect((await subscribe(cookie, { ...subscription, endpoint: "https://evil.example/x" })).status).toBe(400);
    expect((await subscribe(cookie, { ...subscription, keys: { p256dh: "x", auth: "y" } })).status).toBe(400);
  });

  it("can be turned off before agreeing to a changed policy (signing out does)", async () => {
    const id = await createOtherUser({ termsVersion: "2000-01-01" });
    const cookie = await sessionCookieFor(id);
    expect((await call("/api/push/subscription/delete", { method: "POST", body: { endpoint: "https://web.push.apple.com/x" }, cookie })).status).toBe(200);
    expect((await subscribe(cookie, (await newDevice()).subscription)).status).toBe(403);
  });

  it("can't be used from a recovery session", async () => {
    const id = await createOtherUser();
    const cookie = await sessionCookieFor(id, { kind: "recovery" });
    expect((await subscribe(cookie, (await newDevice()).subscription)).status).toBe(403);
  });
});

describe("sending", () => {
  /** A mailbox of the account's, as a connection's device would leave messages in. */
  async function mailboxOf(/** @type {string} */ userId) {
    const id = `mb-${crypto.randomUUID()}`;
    await sql("INSERT INTO mailboxes (id, owner_id, token_hash, kind) VALUES (?, ?, 'h', 'contact')", id, userId).run();
    return id;
  }

  it("a message in my mailbox goes to my devices that want connections, sealed and signed, saying only that", async () => {
    const me = await signedIn();
    const phone = await newDevice();
    const laptop = await newDevice("fcm.googleapis.com");
    const quiet = await newDevice();
    await subscribe(me.cookie, phone.subscription);
    await subscribe(me.cookie, laptop.subscription, { announcements: false });
    await subscribe(me.cookie, quiet.subscription, { connections: false });
    const someoneElse = await signedIn();
    await subscribe(someoneElse.cookie, (await newDevice()).subscription);

    const service = pushService();
    expect(await notifyMailboxOwner(env, await mailboxOf(me.id), service.fetcher)).toEqual({ sent: 2, gone: 0 });
    expect(service.sent.map((s) => s.url).sort()).toEqual([phone.subscription.endpoint, laptop.subscription.endpoint].sort());
    const push = /** @type {(typeof service.sent)[number]} */ (service.sent.find((s) => s.url === phone.subscription.endpoint));
    expect(push.headers).toMatchObject({ "content-encoding": "aes128gcm", topic: "connections", ttl: "86400" });
    expect(push.headers.authorization).toMatch(new RegExp(`^vapid t=[^,]+, k=${env.VAPID_PUBLIC_KEY}$`));
    expect(await phone.open(push.body)).toEqual({ title: "nōtonawa",
      body: "You have something new from a connection. Open nōtonawa to see it.", tag: "connections", url: "/" });
  });

  it("deletes a device the push service says is gone, and keeps one that failed for now", async () => {
    const me = await signedIn();
    const gone = await newDevice();
    const busy = await newDevice();
    await subscribe(me.cookie, gone.subscription);
    await subscribe(me.cookie, busy.subscription);
    const service = pushService({ [gone.subscription.endpoint]: 410, [busy.subscription.endpoint]: 503 });
    expect(await notifyMailboxOwner(env, await mailboxOf(me.id), service.fetcher)).toEqual({ sent: 0, gone: 1 });
    expect(await sql("SELECT endpoint FROM push_subscriptions WHERE user_id = ?", me.id).all())
      .toMatchObject({ results: [{ endpoint: busy.subscription.endpoint }] });
  });

  it("does nothing for a mailbox no one has", async () => {
    const service = pushService();
    expect(await notifyMailboxOwner(env, "mb-none", service.fetcher)).toEqual({ sent: 0, gone: 0 });
    expect(service.sent).toEqual([]);
  });

  it("a delivered message still answers at once (notifying happens after)", async () => {
    const me = await signedIn();
    const token = toBase64url(crypto.getRandomValues(new Uint8Array(32)));
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const box = `mb-${crypto.randomUUID()}`;
    await sql("INSERT INTO mailboxes (id, owner_id, token_hash, kind) VALUES (?, ?, ?, 'contact')", box, me.id, hash).run();
    const res = await call(`/api/mailboxes/${box}/messages`, { method: "POST", body: { token, body: "m1.1.a.b" }, cookie: null });
    expect(res.status).toBe(204);
  });

  describe("notices posted with --push", () => {
    /** @param {{ userId?: string | null, startsAt?: string }} [options] */
    async function notice({ userId = null, startsAt = "2000-01-01T00:00:00Z" } = {}) {
      const id = crypto.randomUUID();
      await sql("INSERT INTO notices (id, user_id, message, starts_at, push) VALUES (?, ?, 'Back up and running', ?, 1)", id, userId, startsAt).run();
      return id;
    }
    const clearOthers = () => sql("UPDATE notices SET pushed_at = '2000-01-01T00:00:00Z' WHERE push = 1 AND pushed_at IS NULL").run();

    it("go to devices that want announcements, once, and only to its account if it's for one", async () => {
      await clearOthers();
      const a = await signedIn();
      const b = await signedIn();
      const aPhone = await newDevice();
      const aQuiet = await newDevice();
      const bPhone = await newDevice();
      await subscribe(a.cookie, aPhone.subscription);
      await subscribe(a.cookie, aQuiet.subscription, { announcements: false });
      await subscribe(b.cookie, bPhone.subscription);
      const forA = await notice({ userId: a.id });
      const later = await notice({ startsAt: "2999-01-01T00:00:00Z" });

      const service = pushService();
      await pushNotices(env, service.fetcher);
      expect(service.sent.map((s) => s.url)).toEqual([aPhone.subscription.endpoint]);
      expect(await aPhone.open(service.sent[0].body)).toEqual({ title: "nōtonawa", body: "Back up and running", tag: `notice-${forA}`, url: "/" });
      expect(await sql("SELECT pushed_at IS NOT NULL AS done FROM notices WHERE id = ?", forA).first()).toEqual({ done: 1 });
      // Not again; one not showing yet waits.
      await pushNotices(env, service.fetcher);
      expect(service.sent).toHaveLength(1);
      expect(await sql("SELECT pushed_at FROM notices WHERE id = ?", later).first()).toEqual({ pushed_at: null });
      await sql("DELETE FROM notices WHERE id = ?", later).run();
    });

    it("go out in batches across runs, picking up where the last stopped", async () => {
      await clearOthers();
      await sql("DELETE FROM push_subscriptions").run();
      const me = await signedIn();
      const statements = [];
      for (let i = 0; i < NOTICE_BATCH + 5; i++) {
        const { subscription } = await newDevice();
        statements.push(env.DB.prepare("INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)")
          .bind(`s-${String(i).padStart(4, "0")}`, me.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth));
      }
      await env.DB.batch(statements);
      const id = await notice();
      const service = pushService();
      await pushNotices(env, service.fetcher);
      expect(service.sent).toHaveLength(NOTICE_BATCH);
      expect(await sql("SELECT push_cursor, pushed_at FROM notices WHERE id = ?", id).first())
        .toEqual({ push_cursor: `s-${String(NOTICE_BATCH - 1).padStart(4, "0")}`, pushed_at: null });
      await pushNotices(env, service.fetcher);
      expect(service.sent).toHaveLength(NOTICE_BATCH + 5);
      expect(new Set(service.sent.map((s) => s.url)).size).toBe(NOTICE_BATCH + 5);
      expect((await sql("SELECT pushed_at FROM notices WHERE id = ?", id).first())?.pushed_at).not.toBeNull();
    });
  });
});
