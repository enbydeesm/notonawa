import { describe, it, expect } from "vitest";
import { call, create, createOtherUser, sql } from "../helpers.js";

describe("plans, people and locations", () => {
  it("adds, lists and edits", async () => {
    const id = await create("/api/plans", { title: "Hip harness", stage: "ready", est_difficulty: "3" });

    const list = await call("/api/plans?archived=false");
    expect(list.status).toBe(200);
    expect(list.body).toContainEqual(expect.objectContaining({
      id, title: "Hip harness", stage: "ready", est_difficulty: 3, version: 1, archived_at: null,
    }));

    const edit = await call(`/api/plans/${id}`, { method: "PUT", body: { title: "Hip harness v2", stage: "ready" } });
    expect(edit.status).toBe(200);
    const plan = await sql("SELECT title, created_at, updated_at FROM plans WHERE id = ?", id).first();
    expect(plan?.title).toBe("Hip harness v2");
    // Timestamps are ISO: 2026-10-12T21:02:58Z
    expect(plan?.updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it("rejects bad input with a friendly message", async () => {
    expect(await call("/api/people", { method: "POST", body: { pronouns: "they/them" } }))
      .toEqual({ status: 400, body: { error: "Give the person a name." } });
    expect(await call("/api/people", { method: "POST", body: "not json" }))
      .toEqual({ status: 400, body: { error: "Expected a JSON object." } });
    expect((await call("/api/locations", { method: "POST", body: { name: "x", maps_url: "javascript:alert(1)" } })).status)
      .toBe(400);
  });

  it("allows only one 'this is me' profile", async () => {
    await create("/api/people", { name: "Me", is_self: true });
    expect(await call("/api/people", { method: "POST", body: { name: "Me again", is_self: true } }))
      .toEqual({ status: 400, body: { error: "You already have a profile marked as you." } });
  });

  it("archives (hidden from the default list) and restores", async () => {
    const id = await create("/api/people", { name: "Alex" });

    const archived = await call(`/api/people/${id}/archive`, { method: "POST" });
    expect(archived.body.archived_at).toMatch(/Z$/);
    // Archiving again keeps the original date.
    expect((await call(`/api/people/${id}/archive`, { method: "POST" })).body.archived_at).toBe(archived.body.archived_at);

    expect((await call("/api/people?archived=false")).body.map((/** @type {any} */ p) => p.id)).not.toContain(id);
    expect((await call("/api/people?archived=true")).body.map((/** @type {any} */ p) => p.id)).toContain(id);

    expect((await call(`/api/people/${id}/restore`, { method: "POST" })).status).toBe(200);
    expect((await call("/api/people?archived=false")).body.map((/** @type {any} */ p) => p.id)).toContain(id);
    // Restoring something that isn't archived is a 404.
    expect((await call(`/api/people/${id}/restore`, { method: "POST" })).status).toBe(404);
  });

  it("lists active, archived or all items, and requires saying which", async () => {
    const active = await create("/api/locations", { name: "Studio" });
    const archived = await create("/api/locations", { name: "Hotel", archive_now: true });
    /** @param {string} query */
    const ids = async (query) => (await call(`/api/locations${query}`)).body.map((/** @type {any} */ l) => l.id);

    expect(await ids("?archived=false")).toContain(active);
    expect(await ids("?archived=false")).not.toContain(archived);
    expect(await ids("?archived=true")).toEqual([archived]);
    expect(await ids("?archived=all")).toEqual(expect.arrayContaining([active, archived]));

    // Forgetting it is an error, not a quiet default.
    for (const query of ["", "?archived=", "?archived=1", "?archived=null"]) {
      const res = await call(`/api/locations${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("archived=false");
    }
  });

  it("restoring a plan keeps its stage", async () => {
    const id = await create("/api/plans", { title: "Futomomo", stage: "developing" });
    await call(`/api/plans/${id}/archive`, { method: "POST" });
    await call(`/api/plans/${id}/restore`, { method: "POST" });
    expect((await sql("SELECT stage FROM plans WHERE id = ?", id).first())?.stage).toBe("developing");
  });

  it("can add a location already archived (a one-off spot)", async () => {
    const id = await create("/api/locations", { name: "Hotel", archive_now: true });
    expect((await call("/api/locations?archived=true")).body.map((/** @type {any} */ l) => l.id)).toContain(id);
  });

  it("stops a plan being a variation of itself", async () => {
    const id = await create("/api/plans", { title: "Loop" });
    const res = await call(`/api/plans/${id}`, { method: "PUT", body: { title: "Loop", variation_of: id } });
    expect(res).toEqual({ status: 400, body: { error: "A plan can't be a variation of itself." } });
  });
});

describe("other users' data", () => {
  it("can't be seen, edited, archived or deleted", async () => {
    const otherId = await createOtherUser();
    await sql("INSERT INTO people (id, owner_id, name) VALUES ('theirs', ?, 'Their person')", otherId).run();

    expect((await call("/api/people?archived=false")).body.map((/** @type {any} */ p) => p.id)).not.toContain("theirs");
    expect((await call("/api/people/theirs", { method: "PUT", body: { name: "Mine now" } })).status).toBe(404);
    expect((await call("/api/people/theirs/archive", { method: "POST" })).status).toBe(404);
    expect((await call("/api/people/theirs", { method: "DELETE" })).status).toBe(404);
    expect((await sql("SELECT name FROM people WHERE id = 'theirs'").first())?.name).toBe("Their person");
  });

  it("can't be linked to a tie", async () => {
    const otherId = await createOtherUser();
    await sql("INSERT INTO locations (id, owner_id, name) VALUES ('their-loc', ?, 'Their place')", otherId).run();
    expect(await call("/api/ties", { method: "POST", body: { title: "x", location_id: "their-loc" } }))
      .toEqual({ status: 400, body: { error: "Linked item not found." } });
  });
});

describe("deleting", () => {
  it("a person keeps their place in ties, shown as deleted", async () => {
    const person = await create("/api/people", { name: "Sam" });
    const tie = await create("/api/ties", { title: "Floor", participants: [{ person_id: person, role: "model" }] });

    expect((await call(`/api/people/${person}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/api/people/${person}`, { method: "DELETE" })).status).toBe(404);

    const listed = (await call("/api/ties")).body.ties.find((/** @type {any} */ t) => t.id === tie);
    expect(listed.participants).toEqual([{ person_id: null, person_name: null, role: "model" }]);
  });

  it("a location marks its ties as '(location deleted)'", async () => {
    const loc = await create("/api/locations", { name: "Studio" });
    const tie = await create("/api/ties", { title: "Suspension", location_id: loc });

    expect((await call(`/api/locations/${loc}`, { method: "DELETE" })).status).toBe(204);
    const listed = (await call("/api/ties")).body.ties.find((/** @type {any} */ t) => t.id === tie);
    expect(listed).toMatchObject({ location_id: null, location_name: null, location_deleted: 1 });
  });

  it("a plan needs a choice about linked ties", async () => {
    const plan = await create("/api/plans", { title: "Hip harness" });
    expect((await call(`/api/plans/${plan}`, { method: "DELETE" })).status).toBe(400);
    expect((await call(`/api/plans/${plan}?linked_ties=maybe`, { method: "DELETE" })).status).toBe(400);
    expect((await sql("SELECT id FROM plans WHERE id = ?", plan).first())).not.toBeNull();
  });

  it("a plan with linked_ties=keep leaves '(plan deleted)' on its ties", async () => {
    const plan = await create("/api/plans", { title: "Hip harness" });
    const tie = await create("/api/ties", { title: "Attempt", plan_ids: [plan] });

    expect((await call(`/api/plans/${plan}?linked_ties=keep`, { method: "DELETE" })).status).toBe(204);
    const listed = (await call("/api/ties")).body.ties.find((/** @type {any} */ t) => t.id === tie);
    expect(listed.plans).toEqual([{ plan_id: null, plan_title: null, plan_version: 1 }]);
  });

  it("a plan with linked_ties=remove drops it from its ties", async () => {
    const plan = await create("/api/plans", { title: "Hip harness" });
    const tie = await create("/api/ties", { title: "Attempt", plan_ids: [plan] });

    expect((await call(`/api/plans/${plan}?linked_ties=remove`, { method: "DELETE" })).status).toBe(204);
    const listed = (await call("/api/ties")).body.ties.find((/** @type {any} */ t) => t.id === tie);
    expect(listed.plans).toEqual([]);
    expect((await call(`/api/plans/${plan}?linked_ties=remove`, { method: "DELETE" })).status).toBe(404);
  });
});
