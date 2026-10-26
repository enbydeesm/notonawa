import { describe, it, expect } from "vitest";
import { env, createScheduledController } from "cloudflare:test";
import worker from "../../src/index.js";
import { call, createOtherUser, sessionCookieFor, sql, sealed } from "../helpers.js";
import { newShareId } from "../../public/js/crypto/share.js";
import { toBase64url } from "../../src/shares/parse.js";

/** Someone signed in, with their own cookie. */
async function account() {
  const id = await createOtherUser();
  return { id, cookie: await sessionCookieFor(id) };
}

/** @typedef {{ id: string, cookie: string }} Account */

/**
 * A profile invite made by `from`.
 * @param {Account} from
 * @param {Record<string, unknown>} [change]
 */
async function invite(from, change = {}) {
  const id = newShareId();
  const res = await call("/api/shares", { method: "POST", cookie: from.cookie, body: {
    id, kind: "profile", label: sealed("Munch invite"), link_key: sealed("key"), expires: "1d", max_uses: 1,
    snapshot: toBase64url(crypto.getRandomValues(new Uint8Array(64))), connect: true, ...change,
  } });
  expect(res.status).toBe(201);
  return id;
}

/**
 * Opens a share as `who`.
 * @param {string} id
 * @param {Account} who
 */
async function open(id, who) {
  const res = await call("/api/shares/open", { method: "POST", body: { id }, cookie: who.cookie });
  expect(res.status).toBe(200);
  return res.body;
}

/**
 * A person of `who`'s.
 * @param {Account} who
 * @param {string} [name]
 */
async function person(who, name = "Alex") {
  const res = await call("/api/people", { method: "POST", body: { name }, cookie: who.cookie });
  expect(res.status).toBe(201);
  return /** @type {string} */ (res.body.id);
}

/**
 * @param {Account} who
 * @param {Record<string, unknown>} body
 */
const accept = (who, body) => call("/api/connections", { method: "POST", body: { label: sealed("Alex"), ...body }, cookie: who.cookie });

const list = async (/** @type {Account} */ who) => (await call("/api/connections", { cookie: who.cookie })).body;
const linkOf = async (/** @type {string} */ id) =>
  /** @type {any} */ (await sql("SELECT connection_id FROM people WHERE id = ?", id).first()).connection_id;

/** A and B, connected through A's invite, B's card for A linked. */
async function connected() {
  const a = await account();
  const b = await account();
  const { offer } = await open(await invite(a), b);
  const card = await person(b);
  const res = await accept(b, { offer, person_id: card });
  expect(res.status).toBe(201);
  return { a, b, card, mine: /** @type {string} */ (res.body.id) };
}

describe("an invite offering to connect", () => {
  it("is only a profile invite", async () => {
    const a = await account();
    const res = await call("/api/shares", { method: "POST", cookie: a.cookie, body: {
      id: newShareId(), kind: "tie", label: null, link_key: sealed("key"), expires: "1d", max_uses: 1,
      snapshot: toBase64url(crypto.getRandomValues(new Uint8Array(64))), connect: true,
    } });
    expect(res.status).toBe(400);
  });

  it("gives someone else who opens it an offer, keeping only its hash", async () => {
    const a = await account();
    const b = await account();
    const id = await invite(a);
    expect((await call("/api/shares", { cookie: a.cookie })).body[0]).toMatchObject({ id, connect: 1 });
    const opened = await open(id, b);
    expect(opened).toMatchObject({ connection_id: null, offer: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    const offers = await sql("SELECT token_hash, owner_id, label FROM connection_offers WHERE owner_id = ?", a.id).all();
    expect(offers.results).toEqual([{ token_hash: expect.not.stringContaining(opened.offer), owner_id: a.id, label: sealed("Munch invite") }]);
  });

  it("gives no offer on my own invite, or on one that doesn't offer to connect", async () => {
    const a = await account();
    const b = await account();
    expect(await open(await invite(a), a)).toMatchObject({ offer: null, connection_id: null });
    expect(await open(await invite(a, { connect: false }), b)).toMatchObject({ offer: null, connection_id: null });
  });
});

describe("accepting an offer", () => {
  it("connects both accounts, links my person, and waits for the inviter to answer", async () => {
    const { a, b, card, mine } = await connected();
    expect(await linkOf(card)).toBe(mine);
    expect(await list(b)).toEqual([{
      id: mine, invited: 0, label: sealed("Alex"), answered: 1, created_at: expect.any(String), person_id: card,
    }]);
    const theirs = await list(a);
    expect(theirs).toEqual([{
      id: expect.any(String), invited: 1, label: sealed("Munch invite"), answered: 0, created_at: expect.any(String), person_id: null,
    }]);
    // Neither side's id is the other's, and no account id is in either.
    expect(theirs[0].id).not.toBe(mine);
    expect(JSON.stringify(theirs)).not.toContain(b.id);
    expect(JSON.stringify(await list(b))).not.toContain(a.id);
  });

  it("spends the offer: it can't be used twice", async () => {
    const a = await account();
    const b = await account();
    const { offer } = await open(await invite(a), b);
    const card = await person(b);
    expect((await accept(b, { offer, person_id: card })).status).toBe(201);
    expect((await accept(b, { offer, person_id: card })).status).toBe(404);
  });

  it("refuses an expired offer, changing nothing", async () => {
    const a = await account();
    const b = await account();
    const { offer } = await open(await invite(a), b);
    await sql("UPDATE connection_offers SET expires_at = '2000-01-01T00:00:00Z' WHERE owner_id = ?", a.id).run();
    const card = await person(b);
    expect((await accept(b, { offer, person_id: card })).status).toBe(404);
    expect(await list(a)).toEqual([]);
    expect(await linkOf(card)).toBeNull();
  });

  it("refuses an offer from my own invite", async () => {
    const a = await account();
    const b = await account();
    const { offer } = await open(await invite(a), b);
    expect((await accept(a, { offer, person_id: await person(a) })).status).toBe(404);
  });

  it("refuses to link someone else's person, or my own profile", async () => {
    const a = await account();
    const b = await account();
    const { offer } = await open(await invite(a), b);
    expect((await accept(b, { offer, person_id: await person(a) })).status).toBe(404);
    const me = crypto.randomUUID();
    await sql("INSERT INTO people (id, owner_id, name, is_self) VALUES (?, ?, 'Me', 1)", me, b.id).run();
    expect((await accept(b, { offer, person_id: me })).status).toBe(404);
    // The offer is still there to use.
    expect((await accept(b, { offer, person_id: await person(b) })).status).toBe(201);
  });

  it("isn't offered again once we're connected: opening tells me which connection it is", async () => {
    const { a, b, mine } = await connected();
    expect(await open(await invite(a), b)).toMatchObject({ offer: null, connection_id: mine });
    // And the other way round.
    const [theirs] = await list(a);
    expect(await open(await invite(b), a)).toMatchObject({ offer: null, connection_id: theirs.id });
  });

  it("uses the connection we have if there's one, moving the link to the person chosen", async () => {
    const a = await account();
    const b = await account();
    // Two offers from A, opened before either was accepted.
    const first = (await open(await invite(a), b)).offer;
    const second = (await open(await invite(a), b)).offer;
    const card = await person(b);
    const other = await person(b, "Alex again");
    const one = (await accept(b, { offer: first, person_id: card })).body.id;
    const two = (await accept(b, { offer: second, person_id: other })).body.id;
    expect(two).toBe(one);
    expect(await linkOf(card)).toBeNull();
    expect(await linkOf(other)).toBe(one);
    expect(await list(a)).toHaveLength(1);
  });

  it("is refused for a sealed label that isn't sealed", async () => {
    const a = await account();
    const b = await account();
    const { offer } = await open(await invite(a), b);
    expect((await accept(b, { offer, person_id: await person(b), label: "Alex" })).status).toBe(400);
  });
});

describe("the inviter's answer", () => {
  it("puts the connection on one of my people, and marks it answered", async () => {
    const { a } = await connected();
    const [theirs] = await list(a);
    const card = await person(a, "Sam");
    const res = await call(`/api/connections/${theirs.id}/person`, { method: "PUT", body: { person_id: card }, cookie: a.cookie });
    expect(res.status).toBe(204);
    expect(await list(a)).toMatchObject([{ id: theirs.id, answered: 1, person_id: card }]);
    // Moving it takes it off the first.
    const other = await person(a, "Sam R");
    await call(`/api/connections/${theirs.id}/person`, { method: "PUT", body: { person_id: other }, cookie: a.cookie });
    expect(await linkOf(card)).toBeNull();
    expect(await linkOf(other)).toBe(theirs.id);
  });

  it("Not now marks it answered without linking anyone", async () => {
    const { a } = await connected();
    const [theirs] = await list(a);
    expect((await call(`/api/connections/${theirs.id}/answered`, { method: "POST", cookie: a.cookie })).status).toBe(204);
    expect(await list(a)).toMatchObject([{ answered: 1, person_id: null }]);
  });

  it("can't touch someone else's side", async () => {
    const { a, b, mine } = await connected();
    expect((await call(`/api/connections/${mine}/answered`, { method: "POST", cookie: a.cookie })).status).toBe(404);
    expect((await call(`/api/connections/${mine}/person`, { method: "PUT", body: { person_id: await person(a) }, cookie: a.cookie })).status)
      .toBe(404);
    expect(await list(b)).toMatchObject([{ id: mine }]);
  });
});

describe("removing a connection", () => {
  it("needs the About choice", async () => {
    const { b, mine } = await connected();
    expect((await call(`/api/connections/${mine}`, { method: "DELETE", cookie: b.cookie })).status).toBe(400);
  });

  it("removes it for both, from either side, unlinking both sides' people", async () => {
    const { a, b, card } = await connected();
    const [theirs] = await list(a);
    const aCard = await person(a, "Sam");
    await call(`/api/connections/${theirs.id}/person`, { method: "PUT", body: { person_id: aCard }, cookie: a.cookie });
    expect((await call(`/api/connections/${theirs.id}?about=keep`, { method: "DELETE", cookie: a.cookie })).status).toBe(204);
    expect(await list(a)).toEqual([]);
    expect(await list(b)).toEqual([]);
    expect(await linkOf(card)).toBeNull();
    expect(await linkOf(aCard)).toBeNull();
  });

  it("can clear my About from their card for me, and nothing else", async () => {
    const { a, b, card } = await connected();
    await sql("UPDATE people SET about = ?, about_shared_on = '2026-10-01', notes = ? WHERE id = ?", sealed("About A"), sealed("B's notes"), card).run();
    const unrelated = await person(b, "Someone else");
    await sql("UPDATE people SET about = ? WHERE id = ?", sealed("Theirs"), unrelated).run();
    const [theirs] = await list(a);
    expect((await call(`/api/connections/${theirs.id}?about=remove`, { method: "DELETE", cookie: a.cookie })).status).toBe(204);
    expect(await sql("SELECT about, about_shared_on, notes FROM people WHERE id = ?", card).first())
      .toEqual({ about: null, about_shared_on: null, notes: sealed("B's notes") });
    expect(await sql("SELECT about FROM people WHERE id = ?", unrelated).first()).toEqual({ about: sealed("Theirs") });
  });

  it("leaves their card's About when I keep it", async () => {
    const { a, card } = await connected();
    await sql("UPDATE people SET about = ? WHERE id = ?", sealed("About A"), card).run();
    const [theirs] = await list(a);
    await call(`/api/connections/${theirs.id}?about=keep`, { method: "DELETE", cookie: a.cookie });
    expect(await sql("SELECT about FROM people WHERE id = ?", card).first()).toEqual({ about: sealed("About A") });
  });

  it("can't remove someone else's", async () => {
    const { a, mine } = await connected();
    const stranger = await account();
    expect((await call(`/api/connections/${mine}?about=remove`, { method: "DELETE", cookie: stranger.cookie })).status).toBe(404);
    expect(await list(a)).toHaveLength(1);
  });

  it("is allowed before agreeing to a changed privacy policy", async () => {
    const { a } = await connected();
    await sql("UPDATE users SET terms_version = '2000-01-01' WHERE id = ?", a.id).run();
    const [theirs] = await list(a);
    expect((await call(`/api/connections/${theirs.id}/answered`, { method: "POST", cookie: a.cookie })).status).toBe(403);
    expect((await call(`/api/connections/${theirs.id}?about=keep`, { method: "DELETE", cookie: a.cookie })).status).toBe(204);
  });
});

describe("deleting an account", () => {
  it("removes its connections, from either side, unlinking the other's person", async () => {
    for (const side of /** @type {const} */ (["a", "b"])) {
      const { a, b, card } = await connected();
      const [theirs] = await list(a);
      const aCard = await person(a, "Sam");
      await call(`/api/connections/${theirs.id}/person`, { method: "PUT", body: { person_id: aCard }, cookie: a.cookie });
      const gone = side === "a" ? a : b;
      const kept = side === "a" ? b : a;
      await sql("DELETE FROM users WHERE id = ?", gone.id).run();
      expect(await list(kept)).toEqual([]);
      expect(await linkOf(side === "a" ? card : aCard)).toBeNull();
    }
  });
});

describe("the daily clean-up", () => {
  it("deletes offers nobody accepted once they've expired", async () => {
    const a = await account();
    const b = await account();
    await open(await invite(a), b);
    await open(await invite(a), b);
    await sql("UPDATE connection_offers SET expires_at = '2000-01-01T00:00:00Z' WHERE rowid = (SELECT min(rowid) FROM connection_offers WHERE owner_id = ?)", a.id).run();
    await worker.scheduled(createScheduledController(), env);
    expect(await sql("SELECT count(*) AS n FROM connection_offers WHERE owner_id = ?", a.id).first()).toEqual({ n: 1 });
  });
});
