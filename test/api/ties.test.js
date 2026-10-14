import { describe, it, expect } from "vitest";
import { call, create, sql, createOtherUser, sessionCookieFor } from "../helpers.js";

describe("ties", () => {
  it("adds a tie with its location, people and plans, and lists it", async () => {
    const me = await create("/api/people", { name: "Me", is_self: true });
    const sam = await create("/api/people", { name: "Sam" });
    const loc = await create("/api/locations", { name: "Studio" });
    const plan = await create("/api/plans", { title: "Hip harness" });

    const id = await create("/api/ties", {
      title: "Floor session",
      tie_date: "2026-10-12",
      tie_type: "floor",
      duration_minutes: 45,
      success_rating: 4,
      location_id: loc,
      participants: [{ person_id: me, role: "rigger" }, { person_id: sam, role: "model" }],
      plan_ids: [plan, plan],
    });

    const tie = (await call("/api/ties/search", { method: "POST", body: {} })).body.ties.find((/** @type {any} */ t) => t.id === id);
    expect(tie).toMatchObject({
      title: "Floor session", tie_date: "2026-10-12", tie_type: "floor", duration_minutes: 45, success_rating: 4,
      location_id: loc, location_name: "Studio", location_deleted: 0,
    });
    expect(tie.participants).toEqual([
      { id: expect.any(String), person_id: me, person_name: "Me", role: "rigger" },
      { id: expect.any(String), person_id: sam, person_name: "Sam", role: "model" },
    ]);
    // Duplicate plan ids are saved once, with the plan's current version.
    expect(tie.plans).toEqual([{ id: expect.any(String), plan_id: plan, plan_title: "Hip harness", plan_version: 1 }]);
  });

  it("lists my active locations most recently tied at first, up to five", async () => {
    // A user of its own, so other tests' ties don't count.
    const cookie = await sessionCookieFor(await createOtherUser());
    const post = async (/** @type {string} */ path, /** @type {any} */ body) =>
      (await call(path, { method: "POST", body, cookie })).body.id;
    const recent = async () => (await call("/api/ties/recent/locations", { cookie })).body;
    expect(await recent()).toEqual([]);

    const names = ["A", "B", "C", "D", "E", "F", "Archived", "Unused"];
    /** @type {Record<string, string>} */
    const ids = {};
    for (const name of names) ids[name] = await post("/api/locations", { name });
    // Tie dates, not the order the ties were added, decide which is most recent.
    const dates = { A: "2026-01-01", B: "2026-06-01", C: "2026-03-01", D: "2026-02-01", E: "2026-05-01", F: "2026-04-01", Archived: "2026-12-01" };
    for (const [name, date] of Object.entries(dates)) {
      await post("/api/ties", { title: name, tie_date: date, location_id: ids[name] });
    }
    // An older tie at B doesn't make B older.
    await post("/api/ties", { title: "B again", tie_date: "2020-01-01", location_id: ids.B });
    await post(`/api/locations/${ids.Archived}/archive`, {});

    expect(await recent()).toEqual([ids.B, ids.E, ids.F, ids.C, ids.D]);
  });

  it("lists my active people and plans most recently on a tie first", async () => {
    const cookie = await sessionCookieFor(await createOtherUser());
    const post = async (/** @type {string} */ path, /** @type {any} */ body) =>
      (await call(path, { method: "POST", body, cookie })).body.id;
    const recent = async (/** @type {string} */ type) => (await call(`/api/ties/recent/${type}`, { cookie })).body;

    const sam = await post("/api/people", { name: "Sam" });
    const alex = await post("/api/people", { name: "Alex" });
    const gone = await post("/api/people", { name: "Gone", archive_now: true });
    const tk = await post("/api/plans", { title: "TK" });
    const hip = await post("/api/plans", { title: "Hip harness" });
    await post("/api/ties", { title: "Old", tie_date: "2026-01-01", participants: [{ person_id: sam, role: "model" }], plan_ids: [tk] });
    await post("/api/ties", {
      title: "New", tie_date: "2026-06-01", plan_ids: [hip],
      participants: [{ person_id: alex, role: "model" }, { person_id: gone, role: "rigger" }],
    });

    expect(await recent("people")).toEqual([alex, sam]);
    expect(await recent("plans")).toEqual([hip, tk]);
    expect((await call("/api/ties/recent/tags", { cookie })).status).toBe(404);
  });

  it("lists newest first", async () => {
    const older = await create("/api/ties", { title: "Older", tie_date: "2020-01-01" });
    const newer = await create("/api/ties", { title: "Newer", tie_date: "2030-01-01" });
    const ids = (await call("/api/ties/search", { method: "POST", body: {} })).body.ties.map((/** @type {any} */ t) => t.id);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
  });

  it("still shows archived people and locations on existing ties", async () => {
    const sam = await create("/api/people", { name: "Sam" });
    const loc = await create("/api/locations", { name: "Old flat" });
    const id = await create("/api/ties", { tie_date: "2026-01-01", title: "x", location_id: loc, participants: [{ person_id: sam, role: "model" }] });

    await call(`/api/people/${sam}/archive`, { method: "POST" });
    await call(`/api/locations/${loc}/archive`, { method: "POST" });

    const tie = (await call("/api/ties/search", { method: "POST", body: {} })).body.ties.find((/** @type {any} */ t) => t.id === id);
    expect(tie.location_name).toBe("Old flat");
    expect(tie.participants[0].person_name).toBe("Sam");
  });

  it("saves nothing if any link is bad", async () => {
    const sam = await create("/api/people", { name: "Sam" });
    const res = await call("/api/ties", {
      method: "POST",
      body: { title: "Half saved?", tie_date: "2026-01-01", participants: [{ person_id: sam, role: "model" }], plan_ids: ["no-such-plan"] },
    });
    expect(res).toEqual({ status: 400, body: { error: "Linked item not found." } });
    expect(await sql("SELECT id FROM ties WHERE title = 'Half saved?'").first()).toBeNull();
  });

  it("rejects bad input", async () => {
    expect((await call("/api/ties", { method: "POST", body: {} })).body.error).toBe("Add a date.");
    expect((await call("/api/ties", { method: "POST", body: { title: "No date" } })).body.error).toBe("Add a date.");
    expect((await call("/api/ties", { method: "POST", body: { title: "x", tie_date: "2026-01-01", participants: [{ person_id: "p", role: "chef" }] } })).status).toBe(400);
    expect(await call("/api/ties", { method: "POST", body: { title: "Bad date", tie_date: "2026-02-30" } }))
      .toEqual({ status: 400, body: { error: "Expected a date like 2026-10-12." } });
    expect(await sql("SELECT id FROM ties WHERE title = 'Bad date'").first()).toBeNull();
  });
});

describe("one tie: GET, PUT and DELETE /api/ties/:id", () => {
  /** A user of its own, with a location, two people and two plans. */
  async function journal() {
    const cookie = await sessionCookieFor(await createOtherUser());
    /** @param {string} path @param {Record<string, unknown>} body */
    const add = async (path, body) => (await call(path, { method: "POST", body, cookie })).body.id;
    return {
      cookie, add,
      studio: await add("/api/locations", { name: "Studio" }),
      garden: await add("/api/locations", { name: "Garden" }),
      sam: await add("/api/people", { name: "Sam" }),
      alex: await add("/api/people", { name: "Alex" }),
      tk: await add("/api/plans", { title: "TK" }),
      hip: await add("/api/plans", { title: "Hip harness" }),
      /** @param {string} id */
      get: async (id) => (await call(`/api/ties/${id}`, { cookie })).body,
      /** @param {string} id @param {Record<string, unknown>} body */
      put: (id, body) => call(`/api/ties/${id}`, { method: "PUT", body, cookie }),
    };
  }

  it("gets a tie with everything on it", async () => {
    const j = await journal();
    const id = await j.add("/api/ties", {
      title: "Floor", tie_date: "2026-05-01", tie_type: "floor", location_id: j.studio, notes: "n",
      participants: [{ person_id: j.sam, role: "model" }], plan_ids: [j.tk], tags: ["kata"],
    });
    expect(await j.get(id)).toMatchObject({
      id, title: "Floor", tie_date: "2026-05-01", tie_type: "floor", location_id: j.studio, location_name: "Studio", notes: "n",
      participants: [{ id: expect.any(String), person_id: j.sam, person_name: "Sam", role: "model" }],
      plans: [{ id: expect.any(String), plan_id: j.tk, plan_title: "TK", plan_version: 1 }],
      tags: ["kata"],
    });
  });

  it("saves every field and replaces the people, plans and tags", async () => {
    const j = await journal();
    const id = await j.add("/api/ties", {
      title: "Before", tie_date: "2026-05-01", location_id: j.studio,
      participants: [{ person_id: j.sam, role: "model" }], plan_ids: [j.tk], tags: ["old"],
    });
    await sql("UPDATE ties SET updated_at = '2020-01-01T00:00:00Z' WHERE id = ?", id).run();
    const res = await j.put(id, {
      title: "After", tie_date: "2026-05-02", tie_type: "suspension", location_id: j.garden,
      duration_minutes: 30, success_rating: 5, notes: "better",
      participants: [{ person_id: j.alex, role: "rigger" }], plan_ids: [j.hip], tags: ["new", "kata"],
    });
    expect(res).toEqual({ status: 200, body: { id } });
    expect(await j.get(id)).toMatchObject({
      title: "After", tie_date: "2026-05-02", tie_type: "suspension", location_name: "Garden",
      duration_minutes: 30, success_rating: 5, notes: "better",
      participants: [expect.objectContaining({ person_name: "Alex", role: "rigger" })],
      plans: [expect.objectContaining({ plan_title: "Hip harness" })],
      tags: ["kata", "new"],
    });
    const row = await sql("SELECT updated_at FROM ties WHERE id = ?", id).first();
    expect(row?.updated_at).not.toBe("2020-01-01T00:00:00Z");
  });

  it("keeps the plan version and a person's link details when they stay on the tie", async () => {
    const j = await journal();
    const id = await j.add("/api/ties", {
      tie_date: "2026-05-01", participants: [{ person_id: j.sam, role: "model" }], plan_ids: [j.tk],
    });
    // As an import might have left them: a rating and notes on Sam's link.
    await sql("UPDATE tie_participants SET experience_rating = 4, notes = 'loved it' WHERE tie_id = ?", id).run();
    await sql("UPDATE plans SET version = 3 WHERE id IN (?, ?)", j.tk, j.hip).run();

    await j.put(id, {
      tie_date: "2026-05-01",
      participants: [{ person_id: j.sam, role: "model" }, { person_id: j.alex, role: "rigger" }],
      plan_ids: [j.tk, j.hip],
    });
    const plans = await sql("SELECT plan_id, plan_version FROM tie_plans WHERE tie_id = ? ORDER BY plan_version", id).all();
    expect(plans.results).toEqual([{ plan_id: j.tk, plan_version: 1 }, { plan_id: j.hip, plan_version: 3 }]);
    const sam = await sql("SELECT experience_rating, notes FROM tie_participants WHERE tie_id = ? AND person_id = ?", id, j.sam).first();
    expect(sam).toEqual({ experience_rating: 4, notes: "loved it" });

    // Sam in a different role is a different link: the details don't carry over.
    await j.put(id, { tie_date: "2026-05-01", participants: [{ person_id: j.sam, role: "rigger" }] });
    expect((await sql("SELECT role, notes FROM tie_participants WHERE tie_id = ?", id).all()).results)
      .toEqual([{ role: "rigger", notes: null }]);
  });

  it("keeps deleted people, plans and a deleted location only when asked to", async () => {
    const j = await journal();
    const id = await j.add("/api/ties", {
      tie_date: "2026-05-01", location_id: j.studio,
      participants: [{ person_id: j.sam, role: "model" }, { person_id: j.alex, role: "rigger" }], plan_ids: [j.tk, j.hip],
    });
    for (const path of [`/api/people/${j.sam}`, `/api/people/${j.alex}`, `/api/locations/${j.studio}`]) {
      await call(path, { method: "DELETE", cookie: j.cookie });
    }
    for (const plan of [j.tk, j.hip]) await call(`/api/plans/${plan}?linked_ties=keep`, { method: "DELETE", cookie: j.cookie });
    const before = await j.get(id);
    expect(before.location_deleted).toBe(1);

    // Keep one deleted person, one deleted plan, and the deleted location.
    await j.put(id, {
      tie_date: "2026-05-01",
      keep_deleted: { participants: [before.participants[0].id], plans: [before.plans[0].id], location: true },
    });
    const kept = await j.get(id);
    expect(kept.participants.map((/** @type {any} */ p) => p.id)).toEqual([before.participants[0].id]);
    expect(kept.plans.map((/** @type {any} */ p) => p.id)).toEqual([before.plans[0].id]);
    expect(kept.location_deleted).toBe(1);

    // Saved without them: they go.
    await j.put(id, { tie_date: "2026-05-01" });
    expect(await j.get(id)).toMatchObject({ participants: [], plans: [], location_deleted: 0 });
  });

  it("deletes a tie, leaving its people, plans and tags", async () => {
    const j = await journal();
    const id = await j.add("/api/ties", {
      tie_date: "2026-05-01", participants: [{ person_id: j.sam, role: "model" }], plan_ids: [j.tk], tags: ["kept-tag"],
    });
    expect((await call(`/api/ties/${id}`, { method: "DELETE", cookie: j.cookie })).status).toBe(204);
    expect((await call(`/api/ties/${id}`, { cookie: j.cookie })).status).toBe(404);
    expect(await sql("SELECT COUNT(*) AS n FROM tie_participants WHERE tie_id = ?", id).first()).toEqual({ n: 0 });
    expect(await sql("SELECT COUNT(*) AS n FROM people WHERE id = ?", j.sam).first()).toEqual({ n: 1 });
    expect(await sql("SELECT COUNT(*) AS n FROM tags WHERE name = 'kept-tag'").first()).toEqual({ n: 1 });
    expect((await call(`/api/ties/${id}`, { method: "DELETE", cookie: j.cookie })).status).toBe(404);
  });

  it("can't get, edit or delete someone else's tie", async () => {
    const mine = await journal();
    const theirs = await journal();
    const id = await theirs.add("/api/ties", { title: "Theirs", tie_date: "2026-05-01", tags: ["their-tag"] });
    expect((await call(`/api/ties/${id}`, { cookie: mine.cookie })).status).toBe(404);
    expect((await mine.put(id, { title: "Mine now", tie_date: "2026-05-01" })).status).toBe(404);
    expect((await call(`/api/ties/${id}`, { method: "DELETE", cookie: mine.cookie })).status).toBe(404);
    expect(await theirs.get(id)).toMatchObject({ title: "Theirs", tags: ["their-tag"] });
  });

  it("rejects an edit without a date, changing nothing", async () => {
    const j = await journal();
    const id = await j.add("/api/ties", { title: "Kept", tie_date: "2026-05-01" });
    expect(await j.put(id, { title: "Gone" })).toEqual({ status: 400, body: { error: "Add a date." } });
    expect((await j.get(id)).title).toBe("Kept");
  });
});
