import { describe, it, expect } from "vitest";
import { call, createOtherUser, sessionCookieFor, sql, signedInUser } from "../helpers.js";
import { POLICY_VERSION } from "../../src/policy-version.js";

/**
 * @param {string | null} userId null: for everyone
 * @param {{ message?: string, startsAt?: string, endsAt?: string | null, link?: string | null }} [options]
 */
async function addNotice(userId, { message = "Hello", startsAt = "2026-01-01T00:00:00Z", endsAt = null, link = null } = {}) {
  const id = crypto.randomUUID();
  await sql("INSERT INTO notices (id, user_id, message, starts_at, ends_at, link) VALUES (?, ?, ?, ?, ?, ?)",
    id, userId, message, startsAt, endsAt, link).run();
  return id;
}

/** @param {string} [cookie] */
const messages = async (cookie) =>
  (await call("/api/notices", { cookie })).body.map((/** @type {any} */ n) => n.message);

describe("notices", () => {
  it("shows ones for everyone and ones just for me, while they're on, until dismissed", async () => {
    const me = await signedInUser();
    const other = await createOtherUser();
    const everyone = await addNotice(null, { message: "For everyone", link: "privacy" });
    await addNotice(me.id, { message: "Just for me", startsAt: "2026-02-01T00:00:00Z" });
    await addNotice(other, { message: "For someone else" });
    await addNotice(null, { message: "Not yet", startsAt: "2999-01-01T00:00:00Z" });
    await addNotice(null, { message: "Over", endsAt: "2026-01-02T00:00:00Z" });

    const list = (await call("/api/notices")).body;
    expect(list.map((/** @type {any} */ n) => n.message)).toEqual(["Just for me", "For everyone"]);
    expect(list[1]).toEqual({ id: everyone, message: "For everyone", level: "info", link: "privacy", starts_at: "2026-01-01T00:00:00Z" });

    expect((await call(`/api/notices/${everyone}/dismiss`, { method: "POST", body: {} })).status).toBe(204);
    expect(await messages()).toEqual(["Just for me"]);
    // Dismissing again is fine; another person still sees it.
    expect((await call(`/api/notices/${everyone}/dismiss`, { method: "POST", body: {} })).status).toBe(204);
    expect(await messages(await sessionCookieFor(other))).toContain("For everyone");
  });

  it("can't dismiss someone else's notice", async () => {
    const other = await createOtherUser();
    const theirs = await addNotice(other, { message: "Theirs" });
    expect((await call(`/api/notices/${theirs}/dismiss`, { method: "POST", body: {} })).status).toBe(404);
    expect(await sql("SELECT count(*) AS n FROM notice_dismissals WHERE notice_id = ?", theirs).first()).toEqual({ n: 0 });
  });

  it("are in my export: mine, and others I dismissed", async () => {
    const id = await createOtherUser();
    const cookie = await sessionCookieFor(id);
    await addNotice(id, { message: "About your data" });
    const general = await addNotice(null, { message: "Maintenance tonight" });
    await addNotice(null, { message: "Not dismissed" });
    await call(`/api/notices/${general}/dismiss`, { method: "POST", body: {}, cookie });
    const notices = (await call("/api/data/export", { cookie })).body.account.notices;
    expect(notices.map((/** @type {any} */ n) => [n.message, n.just_for_me, n.dismissed_at !== null]))
      .toEqual(expect.arrayContaining([["About your data", true, false], ["Maintenance tonight", false, true]]));
    expect(notices).toHaveLength(2);
  });
});

describe("agreeing to a changed privacy policy", () => {
  it("blocks saving anything until I agree, but lets me read, export and manage my account", async () => {
    const id = await createOtherUser({ termsVersion: "2000-01-01T00:00:00Z" });
    const cookie = await sessionCookieFor(id);

    expect((await call("/api/consent", { cookie })).body).toMatchObject({ needed: true, version: POLICY_VERSION });
    expect(await call("/api/people", { method: "POST", body: { name: "Sam" }, cookie }))
      .toEqual({ status: 403, body: { error: "Please agree to the updated privacy policy first.", consent: true } });
    expect((await call("/api/people?archived=false", { cookie })).status).toBe(200);
    expect((await call("/api/data/export", { cookie })).status).toBe(200);
    expect((await call("/api/notices", { cookie })).status).toBe(200);

    // Agreeing needs the box ticked, and the version I was shown.
    expect((await call("/api/consent", { method: "POST", body: { version: POLICY_VERSION }, cookie })).status).toBe(400);
    expect((await call("/api/consent", { method: "POST", body: { version: "1999", agree: true }, cookie })).status).toBe(400);
    expect((await call("/api/consent", { method: "POST", body: { version: POLICY_VERSION, agree: true }, cookie })).status).toBe(204);

    expect((await call("/api/consent", { cookie })).body).toMatchObject({ needed: false });
    expect(await sql("SELECT terms_version, accepted_at IS NOT NULL AS agreed FROM users WHERE id = ?", id).first())
      .toEqual({ terms_version: POLICY_VERSION, agreed: 1 });
    expect((await call("/api/people", { method: "POST", body: { name: "Sam" }, cookie })).status).toBe(201);
  });

  it("asks someone who never agreed (an account from before the policy)", async () => {
    const id = await createOtherUser({ termsVersion: null });
    const cookie = await sessionCookieFor(id);
    expect((await call("/api/consent", { cookie })).body.needed).toBe(true);
    expect((await call("/api/ties", { method: "POST", body: { tie_date: "2026-01-01" }, cookie })).status).toBe(403);
  });

  it("doesn't ask someone who agreed to the current version", async () => {
    expect((await call("/api/consent")).body).toEqual({ needed: false, version: POLICY_VERSION, summary: null });
  });
});
