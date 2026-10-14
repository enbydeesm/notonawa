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
      { person_id: me, person_name: "Me", role: "rigger" },
      { person_id: sam, person_name: "Sam", role: "model" },
    ]);
    // Duplicate plan ids are saved once, with the plan's current version.
    expect(tie.plans).toEqual([{ plan_id: plan, plan_title: "Hip harness", plan_version: 1 }]);
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
