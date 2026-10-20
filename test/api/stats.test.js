import { describe, it, expect, beforeAll } from "vitest";
import { call, create, createOtherUser, sessionCookieFor } from "../helpers.js";

// Tests in this file share a database, so each one keeps to its own dates
// and only looks at the ties in them.

/** @type {string} my own profile ("this is me") */
let me;
beforeAll(async () => {
  me = await create("/api/people", { name: "Me", is_self: true });
});

/** @param {Record<string, unknown>} filters */
async function statsTies(filters) {
  const res = await call("/api/stats/ties", { method: "POST", body: filters });
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body.ties;
}

/** @param {Record<string, unknown>} filters */
async function dates(filters) {
  return (await statsTies(filters)).map((/** @type {any} */ t) => t.tie_date);
}

describe("POST /api/stats/ties", () => {
  it("returns the ties in the range, oldest first, with only what the counting needs", async () => {
    const sam = await create("/api/people", { name: "Sam" });
    const place = await create("/api/locations", { name: "Studio" });
    await create("/api/ties", {
      title: "Secret title", tie_date: "2025-03-02", tie_type: "floor", duration_minutes: 60, success_rating: 4,
      location_id: place, tags: ["statstest-a"],
      participants: [{ person_id: me, role: "top" }, { person_id: sam, role: "bottom" }],
    });
    await create("/api/ties", { tie_type: "floor", tie_date: "2025-03-01" });
    await create("/api/ties", { tie_type: "floor", tie_date: "2025-04-01" });

    const ties = await statsTies({ from: "2025-03-01", to: "2025-03-31" });
    expect(ties.map((/** @type {any} */ t) => t.tie_date)).toEqual(["2025-03-01", "2025-03-02"]);
    const tie = ties[1];
    expect(tie).toEqual({
      id: expect.any(String), tie_date: "2025-03-02", tie_type: "floor", duration_minutes: 60, success_rating: 4,
      location_id: place, location_deleted: 0, location_name: "Studio",
      participants: expect.arrayContaining([
        { person_id: me, person_name: "Me", is_self: true, role: "top" },
        { person_id: sam, person_name: "Sam", is_self: false, role: "bottom" },
      ]),
    });
    // Titles, notes, plans and tags aren't sent.
    expect(tie).not.toHaveProperty("title");
    expect(tie).not.toHaveProperty("notes");
  });

  it("filters by my role (rigger and model from an older page are saved as top and bottom)", async () => {
    const sam = await create("/api/people", { name: "Sam" });
    /** @param {string} tie_date @param {string} role */
    const tie = (tie_date, role) => create("/api/ties", {
      tie_type: "floor", tie_date, participants: [{ person_id: me, role }, { person_id: sam, role: "spotter" }],
    });
    await tie("2025-05-01", "rigger");
    await tie("2025-05-02", "top");
    await tie("2025-05-03", "model");
    await tie("2025-05-04", "bottom");
    await tie("2025-05-05", "photographer");
    await tie("2025-05-07", "self tie");
    // Sam as a top doesn't make it a tie where I was the top.
    await create("/api/ties", { tie_type: "floor", tie_date: "2025-05-06", participants: [{ person_id: sam, role: "top" }] });
    const may = { from: "2025-05-01", to: "2025-05-31" };

    expect(await dates({ ...may, role: "top" })).toEqual(["2025-05-01", "2025-05-02"]);
    expect(await dates({ ...may, role: "bottom" })).toEqual(["2025-05-03", "2025-05-04"]);
    expect(await dates({ ...may, role: "photographer" })).toEqual(["2025-05-05"]);
    expect(await dates({ ...may, role: "self_tie" })).toEqual(["2025-05-07"]);
    expect(await dates({ ...may, role: "spotter" })).toEqual([]);
    expect(await dates({ ...may, role: "all" })).toHaveLength(7);
  });

  it("finds ties with ANY of the people, locations or tags, and different kinds narrow together", async () => {
    const sam = await create("/api/people", { name: "Sam" });
    const alex = await create("/api/people", { name: "Alex" });
    const a = await create("/api/locations", { name: "A" });
    const b = await create("/api/locations", { name: "B" });
    /** @param {string} tie_date @param {string[]} people @param {string} location_id @param {string[]} tags */
    const tie = (tie_date, people, location_id, tags) => create("/api/ties", {
      tie_type: "floor", tie_date, location_id, tags, participants: people.map((person_id) => ({ person_id, role: "bottom" })),
    });
    await tie("2025-06-01", [sam], a, ["statstest-x"]);
    await tie("2025-06-02", [alex], b, ["statstest-y"]);
    await tie("2025-06-03", [sam, alex], b, []);
    await tie("2025-06-04", [], a, ["statstest-x", "statstest-y"]);
    const june = { from: "2025-06-01", to: "2025-06-30" };
    const tags = (await call("/api/tags")).body;
    /** @param {string} name */
    const tagId = (name) => tags.find((/** @type {any} */ t) => t.name === name).id;

    expect(await dates({ ...june, person_ids: [sam, alex] })).toEqual(["2025-06-01", "2025-06-02", "2025-06-03"]);
    expect(await dates({ ...june, location_ids: [a] })).toEqual(["2025-06-01", "2025-06-04"]);
    expect(await dates({ ...june, tag_ids: [tagId("statstest-x"), tagId("statstest-y")] }))
      .toEqual(["2025-06-01", "2025-06-02", "2025-06-04"]);
    // Sam or Alex, and at B.
    expect(await dates({ ...june, person_ids: [sam, alex], location_ids: [b] })).toEqual(["2025-06-02", "2025-06-03"]);
  });

  it("covers all time when no dates are given", async () => {
    await create("/api/ties", { tie_type: "floor", tie_date: "2019-01-01" });
    expect(await dates({})).toContain("2019-01-01");
  });

  it("shows a deleted person and location as such", async () => {
    const gone = await create("/api/people", { name: "Gone" });
    const place = await create("/api/locations", { name: "Gone place" });
    await create("/api/ties", { tie_type: "floor", tie_date: "2025-07-01", location_id: place, participants: [{ person_id: gone, role: "bottom" }] });
    expect((await call(`/api/people/${gone}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/api/locations/${place}`, { method: "DELETE" })).status).toBe(204);

    const [tie] = await statsTies({ from: "2025-07-01", to: "2025-07-01" });
    expect(tie).toMatchObject({ location_id: null, location_deleted: 1, location_name: null });
    expect(tie.participants).toEqual([{ person_id: null, person_name: null, is_self: false, role: "bottom" }]);
  });

  it("only ever sees my own ties", async () => {
    const other = await createOtherUser();
    const cookie = await sessionCookieFor(other);
    await create("/api/ties", { tie_type: "floor", tie_date: "2025-08-01" });
    const res = await call("/api/stats/ties", { method: "POST", body: { from: "2025-08-01", to: "2025-08-01" }, cookie });
    expect(res).toEqual({ status: 200, body: { ties: [] } });
  });

  it("refuses bad filters, other methods and no session", async () => {
    expect((await call("/api/stats/ties", { method: "POST", body: { role: "boss" } })).status).toBe(400);
    expect((await call("/api/stats/ties", { method: "POST", body: { from: "2025-02-01", to: "2025-01-01" } })).status).toBe(400);
    expect((await call("/api/stats/ties")).status).toBe(404);
    expect((await call("/api/stats/ties", { method: "POST", body: {}, cookie: null })).status).toBe(401);
  });
});
