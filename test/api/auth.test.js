// Signing up, in and out with passkeys; sessions; recovery codes; the
// account routes. Uses a software passkey (test/fake-passkey.js).
import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { ORIGIN, call, sql, sessionCookieFor, createOtherUser, fakeWrap } from "../helpers.js";
import { newFakePasskey } from "../fake-passkey.js";
import { sha256Hex, isoAt } from "../../src/auth/session.js";
import { POLICY_VERSION } from "../../src/policy-version.js";
import { newRecoveryCode, readRecoveryCode, loginSecret } from "../../public/js/recovery.js";
import { newCode, normaliseCode } from "../../public/js/codes.js";

let requestCount = 0;

/**
 * POSTs to an auth route as the app's page would. Each call comes from a
 * different IP address unless one is given, so the rate limit stays out of
 * the way.
 * @param {string} path
 * @param {unknown} body
 * @param {{ cookie?: string | null, origin?: string, ip?: string }} [options]
 */
async function post(path, body, { cookie = null, origin = ORIGIN, ip } = {}) {
  /** @type {Record<string, string>} */
  const headers = { "content-type": "application/json", origin, "cf-connecting-ip": ip ?? `10.0.${++requestCount}` };
  if (cookie) headers.cookie = cookie;
  const res = await SELF.fetch(ORIGIN + path, { method: "POST", headers, body: JSON.stringify(body) });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie, cookie: setCookie?.split(";")[0] ?? null };
}

/** @param {{ expiresAt?: string | null }} [options] */
async function makeInvite({ expiresAt = null } = {}) {
  const code = newCode(10);
  await sql("INSERT INTO invites (code_hash, expires_at) VALUES (?, ?)", await sha256Hex(/** @type {string} */ (normaliseCode(code))), expiresAt).run();
  return code;
}

/** @param {string} code */
async function secretFor(code) {
  return loginSecret(/** @type {string} */ (readRecoveryCode(code)));
}

/**
 * Signs up a new account through the API, as the sign-in page does.
 * @param {{ invite?: string }} [options]
 */
async function signUp({ invite } = {}) {
  const passkey = await newFakePasskey();
  const recoveryCode = newRecoveryCode();
  const options = await post("/api/auth/register/options", { invite: invite ?? await makeInvite(), adult: true, consent: true });
  expect(options.status).toBe(200);
  const done = await post("/api/auth/register/verify", {
    response: await passkey.register(options.body), name: "Test phone", prf_capable: true,
    recovery_secret: await secretFor(recoveryCode), recovery_wrap: fakeWrap("recovery"), passkey_wrap: fakeWrap("passkey"),
  });
  expect(done.status).toBe(200);
  const { user_id: userId } = /** @type {{ user_id: string }} */ (await sql("SELECT user_id FROM passkeys WHERE id = ?", passkey.id).first());
  return { passkey, recoveryCode, userId, cookie: /** @type {string} */ (done.cookie) };
}

/**
 * @param {Awaited<ReturnType<typeof newFakePasskey>>} passkey
 * @param {{ cookie?: string | null, prf?: boolean }} [options] prf: say it gave PRF output
 */
async function signIn(passkey, { cookie = null, prf } = {}) {
  const options = await post("/api/auth/login/options", {});
  return post("/api/auth/login/verify", { response: await passkey.authenticate(options.body), prf }, { cookie });
}

/**
 * Adds a second passkey to a signed-in account.
 * @param {string} cookie
 * @param {{ wrap?: any }} [options] the key wrapped for it, if any
 */
async function addPasskey(cookie, { wrap = null } = {}) {
  const passkey = await newFakePasskey();
  const options = await post("/api/auth/register/options", {}, { cookie });
  expect(options.status).toBe(200);
  const done = await post("/api/auth/register/verify", { response: await passkey.register(options.body), name: "Laptop", passkey_wrap: wrap }, { cookie });
  return { passkey, done };
}

/** @param {string | null} cookie */
// A recovery email as the browser sends it: a hash and its salt, base64url.
const EMAIL = { email_hash: "h".repeat(43), salt: "s".repeat(22) };

const tagsStatus = async (cookie) => (await call("/api/tags", { cookie })).status;

describe("signing up", () => {
  it("creates the account, its passkey and a session, with a strict cookie", async () => {
    const invite = await makeInvite();
    const passkey = await newFakePasskey();
    const code = newRecoveryCode();
    const options = await post("/api/auth/register/options", { invite, adult: true, consent: true });
    expect(options.body.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    const done = await post("/api/auth/register/verify", {
      response: await passkey.register(options.body), name: "My phone", prf_capable: true, recovery_secret: await secretFor(code), recovery_wrap: fakeWrap("recovery"),
    });

    expect(done.status).toBe(200);
    expect(done.setCookie).toMatch(/^__Host-session=[\w-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000$/);
    expect(await tagsStatus(done.cookie)).toBe(200);

    const account = (await call("/api/account", { cookie: done.cookie })).body;
    expect(account).toMatchObject({ session_kind: "full", fresh: true, has_recovery_code: true });
    expect(account.passkeys).toMatchObject([{ id: passkey.id, name: "My phone", prf_capable: 1 }]);

    const user = await sql("SELECT * FROM users WHERE id = (SELECT user_id FROM passkeys WHERE id = ?)", passkey.id).first();
    expect(user).toMatchObject({ terms_version: POLICY_VERSION, recovery_secret_hash: await sha256Hex(await secretFor(code)) });
    expect(user?.email).toBe(user?.id);
    expect(user?.accepted_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    // The journal starts with the owner's own profile.
    expect((await call("/api/people?archived=all", { cookie: done.cookie })).body)
      .toEqual([expect.objectContaining({ name: "Me", is_self: 1, default_role: null, archived_at: null })]);
    // The user handle in the passkey is the user's id, not anything personal.
    expect(atob(/** @type {string} */ (passkey.userHandle).replace(/-/g, "+").replace(/_/g, "/"))).toBe(user?.id);
    // Only a hash of the session token is stored.
    const token = /** @type {string} */ (done.cookie).split("=")[1];
    expect(await sql("SELECT 1 FROM sessions WHERE token_hash = ?", token).first()).toBeNull();
    expect(await sql("SELECT used_by FROM invites WHERE code_hash = ?", await sha256Hex(/** @type {string} */ (normaliseCode(invite)))).first())
      .toEqual({ used_by: user?.id });
  });

  it("needs 18+, consent and a working invite", async () => {
    const invite = await makeInvite();
    expect((await post("/api/auth/register/options", { invite, consent: true })).body.error).toMatch(/18 or older/);
    expect((await post("/api/auth/register/options", { invite, adult: true })).body.error).toMatch(/privacy policy/);
    expect((await post("/api/auth/register/options", { invite: "nope", adult: true, consent: true })).body.error)
      .toBe("That invite code doesn't look right.");
    expect((await post("/api/auth/register/options", { invite: newCode(10), adult: true, consent: true })).body.error)
      .toMatch(/doesn't work/);
    const expired = await makeInvite({ expiresAt: "2020-01-01T00:00:00Z" });
    expect((await post("/api/auth/register/options", { invite: expired, adult: true, consent: true })).status).toBe(400);
  });

  it("accepts an invite typed in lower case, without dashes, with look-alike letters", async () => {
    const invite = await makeInvite();
    const typed = invite.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l");
    expect((await post("/api/auth/register/options", { invite: typed, adult: true, consent: true })).status).toBe(200);
  });

  it("lets an invite be used once, even by two sign-ups at the same time", async () => {
    const invite = await makeInvite();
    const [a, b] = [await newFakePasskey(), await newFakePasskey()];
    const optionsA = await post("/api/auth/register/options", { invite, adult: true, consent: true });
    const optionsB = await post("/api/auth/register/options", { invite, adult: true, consent: true });
    const secret = await secretFor(newRecoveryCode());
    expect((await post("/api/auth/register/verify", { response: await a.register(optionsA.body), recovery_secret: secret, recovery_wrap: fakeWrap("recovery") })).status).toBe(200);
    const second = await post("/api/auth/register/verify", { response: await b.register(optionsB.body), recovery_secret: await secretFor(newRecoveryCode()), recovery_wrap: fakeWrap("recovery") });
    expect(second.body).toEqual({ error: "That invite code has already been used or has expired." });
    expect(await sql("SELECT 1 FROM passkeys WHERE id = ?", b.id).first()).toBeNull();
    expect((await post("/api/auth/register/options", { invite, adult: true, consent: true })).status).toBe(400);
  });

  it("refuses a replayed, expired or wrong-site answer", async () => {
    const invite = await makeInvite();
    const passkey = await newFakePasskey();
    const secret = await secretFor(newRecoveryCode());

    const options = await post("/api/auth/register/options", { invite, adult: true, consent: true });
    const wrongSite = await post("/api/auth/register/verify", {
      response: await passkey.register(options.body, { origin: "https://evil.example" }), recovery_secret: secret,
    });
    expect(wrongSite.body.error).toMatch(/Couldn't verify/);
    // The challenge was used up by that attempt.
    const replay = await post("/api/auth/register/verify", { response: await passkey.register(options.body), recovery_secret: secret });
    expect(replay.body.error).toMatch(/too long, or was already used/);

    const late = await post("/api/auth/register/options", { invite, adult: true, consent: true });
    await sql("UPDATE auth_challenges SET expires_at = '2020-01-01T00:00:00Z' WHERE challenge = ?", late.body.challenge).run();
    expect((await post("/api/auth/register/verify", { response: await passkey.register(late.body), recovery_secret: secret })).body.error)
      .toMatch(/too long/);
  });

  it("needs a recovery secret for a new account", async () => {
    const passkey = await newFakePasskey();
    const options = await post("/api/auth/register/options", { invite: await makeInvite(), adult: true, consent: true });
    const res = await post("/api/auth/register/verify", { response: await passkey.register(options.body) });
    expect(res.body.error).toBe("That recovery code didn't work.");
  });
});

describe("signing in", () => {
  it("signs in with a registered passkey and records its use", async () => {
    const { passkey } = await signUp();
    const res = await signIn(passkey);
    expect(res.status).toBe(200);
    expect(await tagsStatus(res.cookie)).toBe(200);
    const row = await sql("SELECT counter, last_used_at FROM passkeys WHERE id = ?", passkey.id).first();
    expect(row?.counter).toBe(1);
    expect(row?.last_used_at).not.toBeNull();
  });

  it("refuses a passkey that isn't registered, or that claims to be someone else's", async () => {
    expect((await signIn(await newFakePasskey())).body.error).toMatch(/isn't registered here/);
    const { passkey } = await signUp();
    const options = await post("/api/auth/login/options", {});
    const response = await passkey.authenticate(options.body, { userHandle: btoa("someone-else") });
    expect((await post("/api/auth/login/verify", { response })).body.error).toMatch(/Couldn't verify/);
  });

  it("replaces the current session when signing in again", async () => {
    const { passkey, cookie } = await signUp();
    const again = await signIn(passkey, { cookie });
    expect(await tagsStatus(again.cookie)).toBe(200);
    expect(await tagsStatus(cookie)).toBe(401);
  });

  it("signs out, ending the session and clearing the cookie", async () => {
    const { cookie } = await signUp();
    const res = await post("/api/auth/logout", {}, { cookie });
    expect(res.setCookie).toMatch(/^__Host-session=; .*Max-Age=0$/);
    expect(await tagsStatus(cookie)).toBe(401);
  });

  it("limits attempts from one address", async () => {
    const statuses = [];
    for (let i = 0; i < 22; i++) statuses.push((await post("/api/auth/login/options", {}, { ip: "192.0.2.1" })).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("sessions", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("are refused when missing, made up, expired or idle for a week", async () => {
    const userId = await createOtherUser();
    expect(await tagsStatus(null)).toBe(401);
    expect(await tagsStatus("__Host-session=made-up")).toBe(401);
    const expired = await sessionCookieFor(userId, { expiresAt: isoAt(Date.now() - 1000) });
    expect(await tagsStatus(expired)).toBe(401);
    const idle = await sessionCookieFor(userId, { lastUsedAt: isoAt(Date.now() - 8 * DAY) });
    expect(await tagsStatus(idle)).toBe(401);
    // Ended sessions are deleted when they're next presented.
    const { n } = /** @type {{ n: number }} */ (await sql("SELECT count(*) AS n FROM sessions WHERE user_id = ?", userId).first());
    expect(n).toBe(0);
  });

  it("note when they were used, at most once an hour", async () => {
    const userId = await createOtherUser();
    const recent = isoAt(Date.now() - 30 * 60 * 1000);
    const old = isoAt(Date.now() - 2 * 60 * 60 * 1000);
    await tagsStatus(await sessionCookieFor(userId, { lastUsedAt: recent }));
    await tagsStatus(await sessionCookieFor(userId, { lastUsedAt: old }));
    const { results } = await sql("SELECT last_used_at FROM sessions WHERE user_id = ? ORDER BY created_at", userId).all();
    const used = results.map((r) => r.last_used_at);
    expect(used).toContain(recent);
    expect(used).not.toContain(old);
  });

  it("can't be used for writes from another site", async () => {
    const res = await call("/api/ties", { method: "POST", body: { title: "x", tie_date: "2026-01-01" }, origin: "https://evil.example" });
    expect(res).toEqual({ status: 403, body: { error: "Not allowed" } });
    expect((await call("/api/ties", { method: "POST", body: { title: "x", tie_date: "2026-01-01" }, origin: null })).status).toBe(403);
  });
});

describe("recovery codes", () => {
  it("sign in for a short session that can only add a passkey, then become a full one", async () => {
    const { recoveryCode, userId } = await signUp();
    const recovered = await post("/api/auth/recover", { recovery_secret: await secretFor(recoveryCode) });
    expect(recovered.setCookie).toMatch(/Max-Age=900$/);
    const cookie = /** @type {string} */ (recovered.cookie);

    expect((await call("/api/account", { cookie })).body.session_kind).toBe("recovery");
    expect(await call("/api/tags", { cookie })).toEqual({ status: 403, body: { error: "Add a passkey to finish signing in.", recovery: true } });

    const { passkey, done } = await addPasskey(cookie);
    expect(done.status).toBe(200);
    expect(await tagsStatus(done.cookie)).toBe(200);
    expect(await tagsStatus(cookie)).toBe(401);
    expect(await sql("SELECT user_id FROM passkeys WHERE id = ?", passkey.id).first()).toEqual({ user_id: userId });
  });

  it("keep working until a new one is made, which replaces it", async () => {
    const { recoveryCode, cookie } = await signUp();
    expect((await post("/api/auth/recover", { recovery_secret: await secretFor(recoveryCode) })).status).toBe(200);

    const newCodeText = newRecoveryCode();
    expect((await call("/api/account/recovery-code", { method: "PUT", body: { recovery_secret: await secretFor(newCodeText), recovery_wrap: fakeWrap("recovery") }, cookie })).status).toBe(204);
    expect((await post("/api/auth/recover", { recovery_secret: await secretFor(recoveryCode) })).body.error).toBe("That recovery code didn't work.");
    expect((await post("/api/auth/recover", { recovery_secret: await secretFor(newCodeText) })).status).toBe(200);
  });

  it("refuse a wrong or malformed code", async () => {
    expect((await post("/api/auth/recover", { recovery_secret: await secretFor(newRecoveryCode()) })).body.error).toBe("That recovery code didn't work.");
    expect((await post("/api/auth/recover", { recovery_secret: "the code itself" })).status).toBe(400);
  });
});

describe("the account", () => {
  it("lists my passkeys and sessions, marking this one, and nobody else's", async () => {
    const { cookie, passkey } = await signUp();
    await signUp();
    const { done } = await addPasskey(cookie);
    expect(done.status).toBe(200);
    const account = (await call("/api/account", { cookie })).body;
    expect(account.passkeys.map((/** @type {any} */ p) => p.name)).toEqual(["Test phone", "Laptop"]);
    expect(account.sessions).toHaveLength(1);
    expect(account.sessions[0]).toMatchObject({ current: true, kind: "full", passkey_name: "Test phone" });
    expect(account.passkeys[0].id).toBe(passkey.id);
  });

  it("renames a passkey, only my own", async () => {
    const { cookie, passkey } = await signUp();
    const other = await signUp();
    expect((await call(`/api/account/passkeys/${passkey.id}`, { method: "PATCH", body: { name: "Old phone" }, cookie })).status).toBe(204);
    expect((await call("/api/account", { cookie })).body.passkeys[0].name).toBe("Old phone");
    expect((await call(`/api/account/passkeys/${other.passkey.id}`, { method: "PATCH", body: { name: "Mine now" }, cookie })).status).toBe(404);
  });

  it("removes a passkey and the sessions it started, but never the last one", async () => {
    const { cookie, passkey } = await signUp();
    expect((await call(`/api/account/passkeys/${passkey.id}`, { method: "DELETE", cookie })).body.error).toMatch(/only passkey/);

    const { passkey: laptop, done } = await addPasskey(cookie);
    const laptopSession = await signIn(laptop);
    expect(done.status).toBe(200);
    expect((await call(`/api/account/passkeys/${laptop.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await tagsStatus(laptopSession.cookie)).toBe(401);
    expect(await tagsStatus(cookie)).toBe(200);
  });

  it("asks to confirm it's you before sensitive changes on an older session", async () => {
    const { userId, passkey } = await signUp();
    const older = await sessionCookieFor(userId, { createdAt: isoAt(Date.now() - 20 * 60 * 1000) });
    const reauth = { error: "Please confirm it's you, then try again.", reauth: true };
    expect((await post("/api/auth/register/options", {}, { cookie: older })).body).toEqual(reauth);
    expect((await call(`/api/account/passkeys/${passkey.id}`, { method: "DELETE", cookie: older })).body).toEqual(reauth);
    expect((await call("/api/account/recovery-code", { method: "PUT", body: { recovery_secret: await secretFor(newRecoveryCode()) }, cookie: older })).body).toEqual(reauth);
    expect((await call("/api/account/recovery-email", { method: "PUT", body: EMAIL, cookie: older })).body).toEqual(reauth);
    expect((await call("/api/account/recovery-email", { method: "DELETE", cookie: older })).body).toEqual(reauth);
    // Renaming isn't sensitive.
    expect((await call(`/api/account/passkeys/${passkey.id}`, { method: "PATCH", body: { name: "x" }, cookie: older })).status).toBe(204);
  });

  it("ends one session, or all the others, but not someone else's", async () => {
    const { cookie, passkey, userId } = await signUp();
    const second = await signIn(passkey);
    const third = await signIn(passkey);
    const other = await signUp();
    const sessions = (await call("/api/account", { cookie })).body.sessions;
    const secondId = sessions.find((/** @type {any} */ s) => !s.current).id;
    const otherSession = /** @type {{ id: string }} */ (await sql("SELECT id FROM sessions WHERE user_id = ?", other.userId).first());

    expect((await call(`/api/account/sessions/${otherSession.id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect((await call(`/api/account/sessions/${secondId}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await call("/api/account/sessions/end-others", { method: "POST", cookie })).status).toBe(204);
    expect([await tagsStatus(cookie), await tagsStatus(second.cookie), await tagsStatus(third.cookie)]).toEqual([200, 401, 401]);
    expect(await tagsStatus(other.cookie)).toBe(200);
    const { n } = /** @type {{ n: number }} */ (await sql("SELECT count(*) AS n FROM sessions WHERE user_id = ?", userId).first());
    expect(n).toBe(1);
  });
});

describe("recovery emails", () => {
  /** @param {string} userId */
  const stored = (userId) => sql("SELECT recovery_email_hash, recovery_email_salt FROM users WHERE id = ?", userId).first();

  it("are set, replaced and removed, as a hash and salt only, for my account alone", async () => {
    const { cookie, userId } = await signUp();
    const other = await signUp();
    expect((await call("/api/account", { cookie })).body.has_recovery_email).toBe(false);

    expect((await call("/api/account/recovery-email", { method: "PUT", body: EMAIL, cookie })).status).toBe(204);
    expect(await stored(userId)).toEqual({ recovery_email_hash: EMAIL.email_hash, recovery_email_salt: EMAIL.salt });
    expect((await call("/api/account", { cookie })).body.has_recovery_email).toBe(true);

    const replaced = { email_hash: "H".repeat(43), salt: "S".repeat(22) };
    expect((await call("/api/account/recovery-email", { method: "PUT", body: replaced, cookie })).status).toBe(204);
    expect(await stored(userId)).toEqual({ recovery_email_hash: replaced.email_hash, recovery_email_salt: replaced.salt });

    expect((await call("/api/account/recovery-email", { method: "DELETE", cookie })).status).toBe(204);
    expect(await stored(userId)).toEqual({ recovery_email_hash: null, recovery_email_salt: null });
    expect(await stored(other.userId)).toEqual({ recovery_email_hash: null, recovery_email_salt: null });
  });

  it("refuse anything but a hash and salt, such as the address itself", async () => {
    const { cookie, userId } = await signUp();
    for (const body of [{ email: "sam@example.com" }, { email_hash: "sam@example.com", salt: EMAIL.salt }, { email_hash: EMAIL.email_hash }]) {
      expect((await call("/api/account/recovery-email", { method: "PUT", body, cookie })).status).toBe(400);
    }
    expect(await stored(userId)).toEqual({ recovery_email_hash: null, recovery_email_salt: null });
  });

  it("can't be set from a recovery session", async () => {
    const { recoveryCode, userId } = await signUp();
    const { cookie } = await post("/api/auth/recover", { recovery_secret: await secretFor(recoveryCode) });
    expect((await call("/api/account/recovery-email", { method: "PUT", body: EMAIL, cookie })).status).toBe(403);
    expect(await stored(userId)).toEqual({ recovery_email_hash: null, recovery_email_salt: null });
  });
});

describe("encryption keys", () => {
  /** @param {string} cookie */
  const keys = async (cookie) => (await call("/api/keys", { cookie })).body;
  /** @param {string} userId */
  const wrapIds = async (userId) => (await sql("SELECT id FROM key_wraps WHERE user_id = ? ORDER BY id", userId).all()).results.map((r) => r.id);

  it("come with sign-up: wrapped for the recovery code and the passkey, and only the user's own", async () => {
    const passkey = await newFakePasskey();
    const code = newRecoveryCode();
    const options = await post("/api/auth/register/options", { invite: await makeInvite(), adult: true, consent: true });
    const recoveryWrap = fakeWrap("recovery");
    const passkeyWrap = fakeWrap("passkey");
    const done = await post("/api/auth/register/verify", {
      response: await passkey.register(options.body), recovery_secret: await secretFor(code),
      recovery_wrap: recoveryWrap, passkey_wrap: passkeyWrap,
    });
    const cookie = /** @type {string} */ (done.cookie);
    await signUp();

    const { kind: _r, ...recovery } = recoveryWrap;
    const { kind: _p, ...ofPasskey } = passkeyWrap;
    expect(await keys(cookie)).toEqual({
      user_id: expect.any(String), has_key: true, passkey_id: passkey.id,
      recovery: { ...recovery, kind: "recovery", current: true }, passkey: { ...ofPasskey, kind: "passkey" },
    });
    expect((await call("/api/account", { cookie })).body.passkeys).toMatchObject([{ unlocks: true }]);
  });

  it("are required at sign-up, and must look like wraps; a bad one saves nothing", async () => {
    const before = (await sql("SELECT count(*) AS n FROM users").first())?.n;
    for (const extra of [{}, { recovery_wrap: { ...fakeWrap("recovery"), wrapped: "short" } }, { recovery_wrap: fakeWrap("passkey") },
      { recovery_wrap: fakeWrap("recovery"), passkey_wrap: { ...fakeWrap("passkey"), version: 2 } }]) {
      const passkey = await newFakePasskey();
      const options = await post("/api/auth/register/options", { invite: await makeInvite(), adult: true, consent: true });
      const res = await post("/api/auth/register/verify", {
        response: await passkey.register(options.body), recovery_secret: await secretFor(newRecoveryCode()), ...extra,
      });
      expect(res.status).toBe(400);
    }
    expect((await sql("SELECT count(*) AS n FROM users").first())?.n).toBe(before);
  });

  it("come with a new passkey when it can unlock, and go with it when it's removed", async () => {
    const { cookie, userId } = await signUp();
    const wrap = fakeWrap("passkey");
    const { passkey: laptop } = await addPasskey(cookie, { wrap });
    const { passkey: tablet } = await addPasskey(cookie);
    expect((await keys(/** @type {string} */ ((await signIn(laptop)).cookie))).passkey?.id).toBe(wrap.id);
    expect((await keys(/** @type {string} */ ((await signIn(tablet)).cookie))).passkey).toBeNull();
    expect((await call("/api/account", { cookie })).body.passkeys.map((/** @type {any} */ p) => p.unlocks)).toEqual([true, true, false]);

    expect((await call(`/api/account/passkeys/${laptop.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await sql("SELECT 1 FROM key_wraps WHERE id = ?", wrap.id).first()).toBeNull();
    expect(await wrapIds(userId)).toHaveLength(2);
  });

  it("are replaced with a new recovery code, which needs one once there's a key", async () => {
    const { cookie, userId } = await signUp();
    const code = newRecoveryCode();
    const put = (/** @type {any} */ body) => call("/api/account/recovery-code", { method: "PUT", body, cookie });
    expect((await put({ recovery_secret: await secretFor(code) })).status).toBe(400);
    const wrap = fakeWrap("recovery");
    expect((await put({ recovery_secret: await secretFor(code), recovery_wrap: wrap })).status).toBe(204);
    expect((await keys(cookie)).recovery).toMatchObject({ id: wrap.id, current: true });
    expect(await wrapIds(userId)).toHaveLength(2);
    expect((await post("/api/auth/recover", { recovery_secret: await secretFor(code) })).status).toBe(200);
  });

  it("say the recovery wrap isn't current once the operator replaces the code without it", async () => {
    const { cookie, userId } = await signUp();
    await sql("UPDATE users SET recovery_secret_hash = ? WHERE id = ?", await sha256Hex(await secretFor(newRecoveryCode())), userId).run();
    expect((await keys(cookie)).recovery.current).toBe(false);
  });

  it("are set up once for an account without one, with a new recovery code, or started afresh on request", async () => {
    const { cookie, userId, passkey } = await signUp();
    await sql("DELETE FROM key_wraps WHERE user_id = ?", userId).run();
    expect(await keys(cookie)).toMatchObject({ has_key: false, recovery: null, passkey: null });

    const code = newRecoveryCode();
    const setup = (/** @type {any} */ body) => call("/api/keys/setup", { method: "POST", body, cookie });
    const first = { recovery_secret: await secretFor(code), recovery_wrap: fakeWrap("recovery"), passkey_wrap: fakeWrap("passkey") };
    expect((await setup(first)).status).toBe(204);
    expect(await keys(cookie)).toMatchObject({ has_key: true, recovery: { id: first.recovery_wrap.id, current: true }, passkey: { id: first.passkey_wrap.id } });
    expect((await post("/api/auth/recover", { recovery_secret: await secretFor(code) })).status).toBe(200);
    expect(await sql("SELECT passkey_id FROM key_wraps WHERE id = ?", first.passkey_wrap.id).first()).toEqual({ passkey_id: passkey.id });

    const again = { recovery_secret: await secretFor(newRecoveryCode()), recovery_wrap: fakeWrap("recovery") };
    expect((await setup(again))).toEqual({ status: 409, body: { error: "Your journal already has an encryption key." } });
    expect((await setup({ ...again, replace: true })).status).toBe(204);
    expect(await wrapIds(userId)).toEqual([again.recovery_wrap.id]);
  });

  it("need a recent sign-in to set up or to wrap for a passkey, and only for my own passkeys", async () => {
    const { userId, passkey, cookie } = await signUp();
    const other = await signUp();
    const older = await sessionCookieFor(userId, { createdAt: isoAt(Date.now() - 20 * 60 * 1000) });
    const reauth = { error: "Please confirm it's you, then try again.", reauth: true };
    const setupBody = { recovery_secret: await secretFor(newRecoveryCode()), recovery_wrap: fakeWrap("recovery"), replace: true };
    expect((await call("/api/keys/setup", { method: "POST", body: setupBody, cookie: older })).body).toEqual(reauth);
    expect((await call(`/api/keys/passkeys/${passkey.id}`, { method: "PUT", body: { wrap: fakeWrap("passkey") }, cookie: older })).body).toEqual(reauth);

    const wrap = fakeWrap("passkey");
    expect((await call(`/api/keys/passkeys/${passkey.id}`, { method: "PUT", body: { wrap }, cookie })).status).toBe(204);
    expect((await keys(cookie)).passkey.id).toBe(wrap.id);
    expect(await wrapIds(userId)).toHaveLength(2);
    expect((await call(`/api/keys/passkeys/${other.passkey.id}`, { method: "PUT", body: { wrap: fakeWrap("passkey") }, cookie })).status).toBe(404);
  });

  it("can be read, but not changed, from a recovery session", async () => {
    const { recoveryCode } = await signUp();
    const { cookie } = await post("/api/auth/recover", { recovery_secret: await secretFor(recoveryCode) });
    expect(await keys(/** @type {string} */ (cookie))).toMatchObject({ has_key: true, passkey_id: null, passkey: null, recovery: { current: true } });
    const body = { recovery_secret: await secretFor(newRecoveryCode()), recovery_wrap: fakeWrap("recovery"), replace: true };
    expect((await call("/api/keys/setup", { method: "POST", body, cookie })).status).toBe(403);
  });

  it("record that a passkey can unlock when it gives PRF output at sign-in", async () => {
    const { cookie } = await signUp();
    const { passkey } = await addPasskey(cookie);
    const capable = async () => (await sql("SELECT prf_capable FROM passkeys WHERE id = ?", passkey.id).first())?.prf_capable;
    expect(await capable()).toBeNull();
    await signIn(passkey);
    expect(await capable()).toBeNull();
    await signIn(passkey, { prf: true });
    expect(await capable()).toBe(1);
    await signIn(passkey);
    expect(await capable()).toBe(1);
  });
});
