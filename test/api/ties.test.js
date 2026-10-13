import { describe, it, expect } from "vitest";
import { call, create, sql } from "../helpers.js";

describe("ties", () => {
  it("adds a tie with its location, people and plans, and lists it", async () => {
    const me = await create("/api/people", { name: "Me", is_self: true });
    const sam = await create("/api/people", { name: "Sam" });
    const loc = await create("/api/locations", { name: "Studio" });
    const plan = await create("/api/plans", { title: "Hip harness" });

    const id = await create("/api/ties", {
      title: "Floor session",
      tie_date: "2026-10-12",
      duration_minutes: 45,
      success_rating: 4,
      location_id: loc,
      participants: [{ person_id: me, role: "rigger" }, { person_id: sam, role: "model" }],
      plan_ids: [plan, plan],
    });

    const tie = (await call("/api/ties/search", { method: "POST", body: {} })).body.ties.find((/** @type {any} */ t) => t.id === id);
    expect(tie).toMatchObject({
      title: "Floor session", tie_date: "2026-10-12", duration_minutes: 45, success_rating: 4,
      location_id: loc, location_name: "Studio", location_deleted: 0,
    });
    expect(tie.participants).toEqual([
      { person_id: me, person_name: "Me", role: "rigger" },
      { person_id: sam, person_name: "Sam", role: "model" },
    ]);
    // Duplicate plan ids are saved once, with the plan's current version.
    expect(tie.plans).toEqual([{ plan_id: plan, plan_title: "Hip harness", plan_version: 1 }]);
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
    const id = await create("/api/ties", { title: "x", location_id: loc, participants: [{ person_id: sam, role: "model" }] });

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
      body: { title: "Half saved?", participants: [{ person_id: sam, role: "model" }], plan_ids: ["no-such-plan"] },
    });
    expect(res).toEqual({ status: 400, body: { error: "Linked item not found." } });
    expect(await sql("SELECT id FROM ties WHERE title = 'Half saved?'").first()).toBeNull();
  });

  it("rejects bad input", async () => {
    expect((await call("/api/ties", { method: "POST", body: {} })).body.error).toBe("Add at least a title or a date.");
    expect((await call("/api/ties", { method: "POST", body: { title: "x", participants: [{ person_id: "p", role: "chef" }] } })).status).toBe(400);
    expect(await call("/api/ties", { method: "POST", body: { title: "Bad date", tie_date: "2026-02-30" } }))
      .toEqual({ status: 400, body: { error: "Expected a date like 2026-10-12." } });
    expect(await sql("SELECT id FROM ties WHERE title = 'Bad date'").first()).toBeNull();
  });
});
