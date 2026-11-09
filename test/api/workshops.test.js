import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";
import { ORIGIN, call, createOtherUser, sessionCookieFor, sql, sealed } from "../helpers.js";

/** A new user of its own, so other tests' workshops don't count. */
async function freshUser() {
  const id = await createOtherUser();
  const cookie = await sessionCookieFor(id);
  /** @param {string} path @param {any} [body] @param {string} [method] */
  const send = (path, body, method = body === undefined ? "GET" : "POST") => call(path, { method, body, cookie });
  /** @param {string} path @param {any} body */
  const post = async (path, body) => (await send(path, body)).body.id;
  return { id, cookie, send, post };
}

/** A whole workshop, with people made for it. @param {Awaited<ReturnType<typeof freshUser>>} user */
async function withPeople(user) {
  const kit = await user.post("/api/people", { name: "Kit", is_educator: true });
  const sam = await user.post("/api/people", { name: "Sam" });
  const loc = await user.post("/api/locations", { name: "Studio" });
  return { kit, sam, loc };
}

describe("workshops", () => {
  it("adds one with its location, educators, participants and tags, and lists it", async () => {
    const user = await freshUser();
    const { kit, sam, loc } = await withPeople(user);
    const id = await user.post("/api/workshops", {
      title: "Intro to floor", start_date: "2026-03-01", end_date: "2026-03-02", location_id: loc,
      attendee_count: 12, rating: 4, difficulty: 3, rating_content: 5, rating_teaching: 4, rating_value: 2,
      cost: sealed("USD 180.00"), event_url: sealed("https://ev"), description: sealed("what"), notes: sealed("notes"), album_url: sealed("album"),
      educators: [{ person_id: kit, role: "top" }], participants: [{ person_id: sam, role: "bottom" }],
      tags: ["Floor", "kata"],
    });

    const list = (await user.send("/api/workshops")).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id, title: "Intro to floor", start_date: "2026-03-01", end_date: "2026-03-02", attendee_count: 12, rating: 4,
      difficulty: 3, rating_content: 5, rating_teaching: 4, rating_value: 2, cost: sealed("USD 180.00"), event_url: sealed("https://ev"),
      description: sealed("what"), notes: sealed("notes"), album_url: sealed("album"),
      created_at: expect.any(String), updated_at: expect.any(String),
      location_id: loc, location_deleted: 0, location_name: "Studio", photo_count: 0, visual_count: 0,
      educators: [{ id: expect.any(String), person_id: kit, person_name: "Kit", role: "top" }],
      participants: [{ id: expect.any(String), person_id: sam, person_name: "Sam", role: "bottom" }],
      tags: ["Floor", "kata"], linked: [],
    });
    expect((await user.send(`/api/workshops/${id}`)).body).toEqual(list[0]);
    // The tags are the same list as ties' and plans', counted for workshops.
    const tags = (await user.send("/api/tags")).body;
    expect(tags.map((/** @type {any} */ t) => [t.name, t.workshop_count, t.tie_count])).toEqual([["Floor", 1, 0], ["kata", 1, 0]]);
  });

  it("lists newest first", async () => {
    const user = await freshUser();
    for (const [title, start_date] of [["Old", "2025-01-01"], ["New", "2026-06-01"], ["Middle", "2026-01-01"]]) {
      await user.post("/api/workshops", { title, start_date });
    }
    expect((await user.send("/api/workshops")).body.map((/** @type {any} */ w) => w.title)).toEqual(["New", "Middle", "Old"]);
  });

  it("refuses a workshop without a title or start date, or with someone on it twice", async () => {
    const user = await freshUser();
    const { kit } = await withPeople(user);
    for (const body of [
      { start_date: "2026-03-01" },
      { title: "x" },
      { title: "x", start_date: "2026-03-01", end_date: "2026-02-01" },
      { title: "x", start_date: "2026-03-01", educators: [{ person_id: kit, role: "top" }], participants: [{ person_id: kit, role: "bottom" }] },
      { title: "x", start_date: "2026-03-01", notes: "plain" },
      { title: "x", start_date: "2026-03-01", cost: "USD 10.00" }, // the cost is sealed
      { title: "x", start_date: "2026-03-01", event_url: "https://example.com" }, // and the event link
      { title: "x", start_date: "2026-03-01", difficulty: 6 },
      { title: "x", start_date: "2026-03-01", rating_value: 0 },
    ]) {
      expect((await user.send("/api/workshops", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await user.send("/api/workshops")).body).toEqual([]);
  });

  it("can't link to someone else's people, location or workshops", async () => {
    const me = await freshUser();
    const them = await freshUser();
    const theirs = await withPeople(them);
    for (const body of [
      { title: "x", start_date: "2026-03-01", location_id: theirs.loc },
      { title: "x", start_date: "2026-03-01", educators: [{ person_id: theirs.kit, role: "top" }] },
    ]) {
      expect(await me.send("/api/workshops", body)).toEqual({ status: 400, body: { error: "Linked item not found." } });
    }
    // Nothing half-saved: the batch saves all or nothing, not even a new tag.
    expect((await me.send("/api/workshops")).body).toEqual([]);
    expect(await me.send("/api/workshops", { title: "x", start_date: "2026-03-01", educators: [{ person_id: theirs.kit, role: "top" }], tags: ["new"] }))
      .toMatchObject({ status: 400 });
    expect((await me.send("/api/tags")).body).toEqual([]);

    const workshop = await them.post("/api/workshops", { title: "Theirs", start_date: "2026-03-01" });
    expect((await me.send(`/api/workshops/${workshop}`)).status).toBe(404);
    expect((await me.send(`/api/workshops/${workshop}`, { title: "Mine", start_date: "2026-03-01" }, "PUT")).status).toBe(404);
    expect((await me.send(`/api/workshops/${workshop}`, undefined, "DELETE")).status).toBe(404);
    expect((await them.send(`/api/workshops/${workshop}`)).body.title).toBe("Theirs");
  });

  it("edits one, replacing its people and tags, and sets updated_at", async () => {
    const user = await freshUser();
    const { kit, sam, loc } = await withPeople(user);
    const id = await user.post("/api/workshops", {
      title: "Intro", start_date: "2026-03-01", location_id: loc,
      educators: [{ person_id: kit, role: "top" }], participants: [{ person_id: sam, role: "bottom" }], tags: ["a"],
    });
    await sql("UPDATE workshops SET updated_at = '2026-01-01T00:00:00Z' WHERE id = ?", id).run();

    // Sam moves from participant to educator, Kit to participant.
    const res = await user.send(`/api/workshops/${id}`, {
      title: "Intro 2", start_date: "2026-03-02", attendee_count: 3, difficulty: 2, rating_teaching: 5, cost: sealed("CAD 40.00"),
      educators: [{ person_id: sam, role: "top" }], participants: [{ person_id: kit, role: "audit" }], tags: ["b"],
    }, "PUT");
    expect(res).toEqual({ status: 200, body: { id } });
    const w = (await user.send(`/api/workshops/${id}`)).body;
    expect(w).toMatchObject({
      title: "Intro 2", start_date: "2026-03-02", attendee_count: 3, location_id: null, tags: ["b"],
      difficulty: 2, rating_content: null, rating_teaching: 5, rating_value: null, cost: sealed("CAD 40.00"),
    });
    expect(w.educators.map((/** @type {any} */ p) => [p.person_name, p.role])).toEqual([["Sam", "top"]]);
    expect(w.participants.map((/** @type {any} */ p) => [p.person_name, p.role])).toEqual([["Kit", "audit"]]);
    expect(w.updated_at).not.toBe("2026-01-01T00:00:00Z");
  });

  it("shows deleted people and a deleted location, keeping them on an edit only if asked", async () => {
    const user = await freshUser();
    const { kit, sam, loc } = await withPeople(user);
    const id = await user.post("/api/workshops", {
      title: "Intro", start_date: "2026-03-01", location_id: loc,
      educators: [{ person_id: kit, role: "top" }], participants: [{ person_id: sam, role: "bottom" }],
    });
    await user.send(`/api/people/${kit}`, undefined, "DELETE");
    await user.send(`/api/people/${sam}`, undefined, "DELETE");
    await user.send(`/api/locations/${loc}`, undefined, "DELETE");
    const w = (await user.send(`/api/workshops/${id}`)).body;
    expect(w).toMatchObject({ location_id: null, location_deleted: 1, location_name: null });
    expect(w.educators).toEqual([{ id: expect.any(String), person_id: null, person_name: null, role: "top" }]);

    // Keep the deleted educator and the location; drop the participant.
    const base = { title: "Intro", start_date: "2026-03-01" };
    await user.send(`/api/workshops/${id}`, { ...base, keep_deleted: { people: [w.educators[0].id], location: true } }, "PUT");
    const kept = (await user.send(`/api/workshops/${id}`)).body;
    expect(kept).toMatchObject({ location_deleted: 1, participants: [] });
    expect(kept.educators).toHaveLength(1);

    await user.send(`/api/workshops/${id}`, base, "PUT");
    expect((await user.send(`/api/workshops/${id}`)).body).toMatchObject({ location_deleted: 0, educators: [], participants: [] });
  });

  it("deletes one with its photos and their files, leaving its people, location and tags", async () => {
    const user = await freshUser();
    const { kit, loc } = await withPeople(user);
    const id = await user.post("/api/workshops", {
      title: "Intro", start_date: "2026-03-01", location_id: loc, educators: [{ person_id: kit, role: "top" }], tags: ["kept"],
    });
    const photo = crypto.randomUUID();
    const query = new URLSearchParams({ workshop_id: id, kind: "photo", mime: "image/jpeg", thumb_bytes: "10" });
    const uploaded = await SELF.fetch(`${ORIGIN}/api/media/${photo}?${query}`, {
      method: "PUT", headers: { cookie: user.cookie, origin: ORIGIN }, body: new Uint8Array(40).fill(1),
    });
    expect(uploaded.status).toBe(201);
    expect((await user.send(`/api/workshops/${id}`)).body.photo_count).toBe(1);
    expect((await user.send(`/api/media?workshop_id=${id}`)).body.map((/** @type {any} */ m) => m.id)).toEqual([photo]);

    expect((await user.send(`/api/workshops/${id}`, undefined, "DELETE")).status).toBe(204);
    expect((await user.send(`/api/workshops/${id}`)).status).toBe(404);
    expect(await env.PHOTOS.head(`${user.id}/${photo}`)).toBeNull();
    expect(await sql("SELECT id FROM media WHERE id = ?", photo).first()).toBeNull();
    expect((await user.send("/api/people?archived=all")).body.some((/** @type {any} */ p) => p.id === kit)).toBe(true);
    expect((await user.send("/api/tags")).body.map((/** @type {any} */ t) => t.name)).toEqual(["kept"]);
  });

  it("links ties and plans to a workshop, listing them plans first, and both ways", async () => {
    const user = await freshUser();
    const ws = await user.post("/api/workshops", { title: "Intensive", start_date: "2026-04-01" });
    const other = await user.post("/api/workshops", { title: "Other", start_date: "2026-05-01" });
    const plan = await user.post("/api/plans", { title: "Gote" });
    const early = await user.post("/api/ties", { title: "First try", tie_date: "2026-04-01", tie_type: "floor" });
    // Made already linked, as the tie form does for a tie started from a workshop.
    const later = await user.post("/api/ties", { tie_date: "2026-04-02", tie_type: "floor", workshop_id: ws });
    await sql("UPDATE ties SET updated_at = '2026-01-01T00:00:00Z' WHERE id = ?", early).run();

    expect(await user.send(`/api/workshops/${ws}/links`, { tie_id: early })).toEqual({ status: 200, body: { id: early } });
    expect((await user.send(`/api/workshops/${ws}/links`, { plan_id: plan })).status).toBe(200);
    expect((await user.send(`/api/workshops/${ws}`)).body.linked).toEqual([
      { kind: "plan", id: plan, title: "Gote", date: null },
      { kind: "tie", id: early, title: "First try", date: "2026-04-01" },
      { kind: "tie", id: later, title: null, date: "2026-04-02" },
    ]);
    // The other way: the tie and the plan name their workshop, and linking set updated_at.
    const tie = (await user.send(`/api/ties/${early}`)).body;
    expect([tie.workshop_id, tie.workshop_title, tie.updated_at === "2026-01-01T00:00:00Z"]).toEqual([ws, "Intensive", false]);
    const plans = (await user.send("/api/plans?archived=false")).body;
    expect(plans.map((/** @type {any} */ p) => [p.workshop_id, p.workshop_title])).toEqual([[ws, "Intensive"]]);

    // One workshop each: linking it to another moves it.
    await user.send(`/api/workshops/${other}/links`, { tie_id: early });
    expect((await user.send(`/api/workshops/${ws}`)).body.linked.map((/** @type {any} */ l) => l.id)).toEqual([plan, later]);
    // Unlinking only from the workshop it's on.
    expect((await user.send(`/api/workshops/${ws}/links?tie_id=${early}`, undefined, "DELETE")).status).toBe(404);
    expect((await user.send(`/api/workshops/${other}/links?tie_id=${early}`, undefined, "DELETE")).status).toBe(204);
    expect((await user.send(`/api/ties/${early}`)).body.workshop_id).toBeNull();
    // Both or neither isn't a link.
    expect((await user.send(`/api/workshops/${ws}/links`, { tie_id: early, plan_id: plan })).status).toBe(400);
    expect((await user.send(`/api/workshops/${ws}/links`, {})).status).toBe(400);

    // Deleting the workshop unlinks its ties and plans, which stay.
    await user.send(`/api/workshops/${ws}`, undefined, "DELETE");
    expect((await user.send(`/api/ties/${later}`)).body.workshop_id).toBeNull();
    expect((await user.send("/api/plans?archived=false")).body[0].workshop_id).toBeNull();
  });

  it("can't link someone else's ties and plans, or mine to their workshop", async () => {
    const me = await freshUser();
    const them = await freshUser();
    const mine = await me.post("/api/workshops", { title: "Mine", start_date: "2026-04-01" });
    const myTie = await me.post("/api/ties", { tie_date: "2026-04-01", tie_type: "floor" });
    const theirs = await them.post("/api/workshops", { title: "Theirs", start_date: "2026-04-01" });
    const theirTie = await them.post("/api/ties", { tie_date: "2026-04-01", tie_type: "floor" });
    const theirPlan = await them.post("/api/plans", { title: "Theirs" });
    expect((await me.send(`/api/workshops/${mine}/links`, { tie_id: theirTie })).status).toBe(404);
    expect((await me.send(`/api/workshops/${mine}/links`, { plan_id: theirPlan })).status).toBe(404);
    expect((await me.send(`/api/workshops/${theirs}/links`, { tie_id: myTie })).status).toBe(404);
    expect(await me.send("/api/ties", { tie_date: "2026-04-01", tie_type: "floor", workshop_id: theirs }))
      .toEqual({ status: 400, body: { error: "Linked item not found." } });
    expect(await me.send("/api/plans", { title: "x", workshop_id: theirs })).toEqual({ status: 400, body: { error: "Linked item not found." } });
    expect((await them.send(`/api/workshops/${theirs}`)).body.linked).toEqual([]);
  });
});
