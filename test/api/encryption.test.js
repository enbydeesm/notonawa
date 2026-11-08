// Encrypted notes on the server: plain text refused, older plain text found
// and replaced (/api/encryption/), and a new key emptying the fields.
import { describe, it, expect } from "vitest";
import { call, createOtherUser, sessionCookieFor, sql, sealed } from "../helpers.js";

/** A new user, signed in just now, with one of everything that has notes. */
async function userWithPlainNotes() {
  const id = await createOtherUser();
  const cookie = await sessionCookieFor(id);
  const run = (/** @type {string} */ q, /** @type {unknown[]} */ ...params) => sql(q, ...params).run();
  // As written before encryption: plain text, straight into the database.
  await run("INSERT INTO people (id, owner_id, name, notes, updated_at) VALUES (?, ?, 'Sam', 'plain person', '2026-01-01T00:00:00Z')", `p-${id}`, id);
  await run("INSERT INTO profile_notes (id, person_id, type, description) VALUES (?, ?, 'like', 'plain like')", `n-${id}`, `p-${id}`);
  await run("INSERT INTO locations (id, owner_id, name, notes) VALUES (?, ?, 'Studio', 'plain location')", `l-${id}`, id);
  await run("INSERT INTO plans (id, owner_id, title, description, notes) VALUES (?, ?, 'TK', 'plain steps', ?)", `pl-${id}`, id, sealed("already sealed"));
  await run("INSERT INTO ties (id, owner_id, title, tie_date, tie_type, notes) VALUES (?, ?, 'Floor', '2026-01-01', 'floor', 'plain tie')", `t-${id}`, id);
  await run("INSERT INTO tie_participants (id, tie_id, person_id, role, notes) VALUES (?, ?, ?, 'bottom', 'plain part')", `tp-${id}`, `t-${id}`, `p-${id}`);
  await run("INSERT INTO workshops (id, owner_id, title, start_date, description) VALUES (?, ?, 'Intro', '2026-01-01', 'plain class')", `w-${id}`, id);
  await run("INSERT INTO drawings (id, owner_id, tie_id, data, caption, position) VALUES (?, ?, ?, '{}', 'plain caption', 0)", `d-${id}`, id, `t-${id}`);
  await run("INSERT INTO poses (id, owner_id, tie_id, data, caption, position) VALUES (?, ?, ?, '{}', 'plain pose', 0)", `po-${id}`, id, `t-${id}`);
  // Already encrypted, or empty: not pending.
  await run("INSERT INTO ties (id, owner_id, title, tie_date, tie_type, notes) VALUES (?, ?, 'Done', '2026-01-02', 'floor', ?)", `t2-${id}`, id, sealed("done"));
  await run("INSERT INTO ties (id, owner_id, title, tie_date, tie_type) VALUES (?, ?, 'Empty', '2026-01-03', 'floor')", `t3-${id}`, id);
  return { id, cookie };
}

describe("encrypting older notes", () => {
  it("lists only my rows still holding plain text, with all their encrypted fields", async () => {
    const me = await userWithPlainNotes();
    await userWithPlainNotes();
    const pending = (await call("/api/encryption/pending", { cookie: me.cookie })).body;
    expect(pending).toEqual({
      ties: [{ id: `t-${me.id}`, notes: "plain tie", album_url: null }],
      tie_participants: [{ id: `tp-${me.id}`, notes: "plain part" }],
      people: [{ id: `p-${me.id}`, notes: "plain person", based_in: null, aliases: null, about: null }],
      profile_notes: [{ id: `n-${me.id}`, description: "plain like" }],
      locations: [{ id: `l-${me.id}`, notes: "plain location" }],
      plans: [{ id: `pl-${me.id}`, description: "plain steps", notes: sealed("already sealed"), album_url: null }],
      workshops: [{ id: `w-${me.id}`, description: "plain class", notes: null, album_url: null, cost: null }],
      drawings: [{ id: `d-${me.id}`, caption: "plain caption" }],
      poses: [{ id: `po-${me.id}`, caption: "plain pose" }],
      // A share's name, and a saved preset's, is sealed when it's made, so
      // there's never any plain.
      shares: [],
      pose_presets: [],
      connections: [],
    });
  });

  it("overwrites the plain text with what's sent, without changing updated_at, and then nothing's pending", async () => {
    const me = await userWithPlainNotes();
    const body = {
      ties: [{ id: `t-${me.id}`, notes: sealed("tie") }],
      tie_participants: [{ id: `tp-${me.id}`, notes: sealed("part") }],
      people: [{ id: `p-${me.id}`, notes: sealed("person") }],
      profile_notes: [{ id: `n-${me.id}`, description: sealed("like") }],
      locations: [{ id: `l-${me.id}`, notes: sealed("location") }],
      // Its notes were sealed already: sent again with a different value, kept as they were.
      plans: [{ id: `pl-${me.id}`, description: sealed("steps"), notes: sealed("not this") }],
      workshops: [{ id: `w-${me.id}`, description: sealed("class") }],
      drawings: [{ id: `d-${me.id}`, caption: sealed("caption") }],
      poses: [{ id: `po-${me.id}`, caption: sealed("pose") }],
    };
    expect((await call("/api/encryption/seal", { method: "POST", body, cookie: me.cookie })).status).toBe(204);
    expect(await sql("SELECT notes, updated_at FROM people WHERE id = ?", `p-${me.id}`).first())
      .toEqual({ notes: sealed("person"), updated_at: "2026-01-01T00:00:00Z" });
    expect(await sql("SELECT description, notes FROM plans WHERE id = ?", `pl-${me.id}`).first())
      .toEqual({ description: sealed("steps"), notes: sealed("already sealed") });
    expect(await sql("SELECT description FROM profile_notes WHERE id = ?", `n-${me.id}`).first()).toEqual({ description: sealed("like") });
    const pending = (await call("/api/encryption/pending", { cookie: me.cookie })).body;
    expect(Object.values(pending).every((rows) => /** @type {any[]} */ (rows).length === 0)).toBe(true);
  });

  it("never touches another user's rows, and refuses anything not sealed", async () => {
    const me = await userWithPlainNotes();
    const them = await userWithPlainNotes();
    const res = await call("/api/encryption/seal", { method: "POST", cookie: me.cookie, body: {
      ties: [{ id: `t-${them.id}`, notes: sealed("mine now") }],
      tie_participants: [{ id: `tp-${them.id}`, notes: sealed("mine now") }],
      profile_notes: [{ id: `n-${them.id}`, description: sealed("mine now") }],
    } });
    expect(res.status).toBe(204);
    expect(await sql("SELECT notes FROM ties WHERE id = ?", `t-${them.id}`).first()).toEqual({ notes: "plain tie" });
    expect(await sql("SELECT notes FROM tie_participants WHERE id = ?", `tp-${them.id}`).first()).toEqual({ notes: "plain part" });
    expect(await sql("SELECT description FROM profile_notes WHERE id = ?", `n-${them.id}`).first()).toEqual({ description: "plain like" });

    for (const body of [{ ties: [{ id: `t-${me.id}`, notes: "still plain" }] }, { users: [{ id: me.id }] }, { ties: "x" }]) {
      expect((await call("/api/encryption/seal", { method: "POST", body, cookie: me.cookie })).status).toBe(400);
    }
    expect(await sql("SELECT notes FROM ties WHERE id = ?", `t-${me.id}`).first()).toEqual({ notes: "plain tie" });
  });

  it("refuses plain notes from the app's forms", async () => {
    const { cookie } = await userWithPlainNotes();
    for (const [path, body] of /** @type {[string, any][]} */ ([
      ["/api/people", { name: "Alex", notes: "plain" }],
      ["/api/locations", { name: "Beach", notes: "plain" }],
      ["/api/plans", { title: "Box", description: "plain" }],
      ["/api/plans", { title: "Box", notes: "plain" }],
    ])) {
      expect((await call(path, { method: "POST", body, cookie })).status, `${path} ${JSON.stringify(body)}`).toBe(400);
    }
    expect((await call("/api/people", { method: "POST", body: { name: "Alex", notes: sealed("ok") }, cookie })).status).toBe(201);
  });
});

describe("starting a new key", () => {
  it("empties every encrypted field, which the new key couldn't read (profile notes go: they're only a description)", async () => {
    const me = await userWithPlainNotes();
    const other = await userWithPlainNotes();
    const { fakeWrap } = await import("../helpers.js");
    const { loginSecret, newRecoveryCode, readRecoveryCode } = await import("../../public/js/recovery.js");
    const secret = await loginSecret(/** @type {string} */ (readRecoveryCode(newRecoveryCode())));
    const res = await call("/api/keys/setup", { method: "POST", cookie: me.cookie, body: { recovery_secret: secret, recovery_wrap: fakeWrap("recovery"), replace: true } });
    expect(res.status).toBe(204);
    for (const [table, column] of [["ties", "notes"], ["people", "notes"], ["locations", "notes"], ["plans", "description"], ["plans", "notes"]]) {
      expect(await sql(`SELECT count(*) AS n FROM ${table} WHERE owner_id = ? AND ${column} IS NOT NULL`, me.id).first(), table).toEqual({ n: 0 });
    }
    expect(await sql("SELECT notes FROM tie_participants WHERE id = ?", `tp-${me.id}`).first()).toEqual({ notes: null });
    expect(await sql("SELECT 1 FROM profile_notes WHERE id = ?", `n-${me.id}`).first()).toBeNull();
    expect(await sql("SELECT 1 FROM profile_notes WHERE id = ?", `n-${other.id}`).first()).not.toBeNull();
    // Not theirs.
    expect(await sql("SELECT notes FROM ties WHERE id = ?", `t-${other.id}`).first()).toEqual({ notes: "plain tie" });
  });
});
