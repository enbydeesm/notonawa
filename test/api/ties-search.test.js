import { describe, it, expect } from "vitest";
import { call, create, createOtherUser, sessionCookieFor, sql, sealed } from "../helpers.js";

// Tests in this file share a database, so each one makes its own people,
// locations and keywords and only looks at the ties it made.

/**
 * Searches the ties list.
 * @param {Record<string, unknown>} filters
 */
function search(filters) {
  return call("/api/ties/search", { method: "POST", body: filters });
}

/**
 * The titles of the ties a search returns.
 * @param {Record<string, unknown>} filters
 */
async function titles(filters) {
  const res = await search(filters);
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body.ties.map((/** @type {any} */ t) => t.title);
}

describe("searching ties", () => {
  it("by people: ties with all of the chosen people", async () => {
    const sam = await create("/api/people", { name: "Sam" });
    const alex = await create("/api/people", { name: "Alex" });
    /** @param {string} title @param {string[]} people */
    const tie = (title, people) => create("/api/ties", {
      title, tie_type: "floor", tie_date: "2026-01-01", participants: people.map((person_id) => ({ person_id, role: "bottom" })),
    });
    await tie("Both", [sam, alex]);
    await tie("Sam only", [sam]);
    await tie("Alex only", [alex]);

    expect(await titles({ person_ids: [sam, alex] })).toEqual(["Both"]);
    expect((await titles({ person_ids: [sam] })).sort()).toEqual(["Both", "Sam only"]);
    // The same person chosen twice still counts once.
    expect(await titles({ person_ids: [sam, sam, alex] })).toEqual(["Both"]);
  });

  it("finds a person who took part in two roles", async () => {
    const sam = await create("/api/people", { name: "Sam" });
    const alex = await create("/api/people", { name: "Alex" });
    await create("/api/ties", { tie_type: "floor", tie_date: "2026-01-01",
      title: "Switch", participants: [{ person_id: sam, role: "top" }, { person_id: sam, role: "bottom" }],
    });
    expect(await titles({ person_ids: [sam] })).toEqual(["Switch"]);
    // Sam twice doesn't count as Sam and Alex.
    expect(await titles({ person_ids: [sam, alex] })).toEqual([]);
  });

  it("by location: ties at any of the chosen locations", async () => {
    const a = await create("/api/locations", { name: "A" });
    const b = await create("/api/locations", { name: "B" });
    const c = await create("/api/locations", { name: "C" });
    await create("/api/ties", { title: "At A", tie_type: "floor", tie_date: "2026-01-03", location_id: a });
    await create("/api/ties", { title: "At B", tie_type: "floor", tie_date: "2026-01-02", location_id: b });
    await create("/api/ties", { title: "At C", tie_type: "floor", tie_date: "2026-01-01", location_id: c });

    expect(await titles({ location_ids: [a, b] })).toEqual(["At A", "At B"]);
  });

  it("by tags: ties with any of them, or with all of them", async () => {
    // Tag names are unique per user and the tests share a database.
    await create("/api/ties", { title: "Both tags", tie_type: "floor", tie_date: "2026-01-03", tags: ["tagtest-a", "tagtest-b"] });
    await create("/api/ties", { title: "A only", tie_type: "floor", tie_date: "2026-01-02", tags: ["tagtest-a"] });
    await create("/api/ties", { title: "B only", tie_type: "floor", tie_date: "2026-01-01", tags: ["tagtest-b"] });
    await create("/api/ties", { title: "C only", tie_type: "floor", tie_date: "2026-01-01", tags: ["tagtest-c"] });
    const tags = (await call("/api/tags")).body;
    /** @param {string} name */
    const id = (name) => tags.find((/** @type {any} */ t) => t.name === name).id;
    const ab = [id("tagtest-a"), id("tagtest-b")];

    expect(await titles({ tag_ids: ab })).toEqual(["Both tags", "A only", "B only"]);
    expect(await titles({ tag_ids: ab, tag_match: "any" })).toEqual(["Both tags", "A only", "B only"]);
    expect(await titles({ tag_ids: ab, tag_match: "all" })).toEqual(["Both tags"]);
    expect(await titles({ tag_ids: [id("tagtest-c")], tag_match: "all" })).toEqual(["C only"]);
    expect((await search({ tag_match: "most" })).status).toBe(400);
  });

  it("by tie date, from and to inclusive", async () => {
    const loc = await create("/api/locations", { name: "Dates" });
    for (const [title, tie_date] of [["Jan", "2025-01-15"], ["Feb", "2025-02-01"], ["Mar", "2025-03-31"]]) {
      await create("/api/ties", { title, tie_type: "floor", tie_date, location_id: loc });
    }
    const at = { location_ids: [loc] };
    expect(await titles({ ...at, from: "2025-02-01", to: "2025-03-31" })).toEqual(["Mar", "Feb"]);
    expect(await titles({ ...at, from: "2025-02-02" })).toEqual(["Mar"]);
    expect(await titles({ ...at, to: "2025-01-15" })).toEqual(["Jan"]);
    expect(await titles(at)).toEqual(["Mar", "Feb", "Jan"]);
  });

  it("keeps only the ties a keyword matched on the device (match_ids), with the other filters", async () => {
    const sam = await create("/api/people", { name: "Sam" });
    const loc = await create("/api/locations", { name: "Combo" });
    const with_ = [{ person_id: sam, role: "bottom" }];
    const right = await create("/api/ties", { title: "Right", tie_type: "floor", tie_date: "2026-05-01", location_id: loc, participants: with_ });
    const wrongDate = await create("/api/ties", { title: "Wrong date", tie_type: "floor", tie_date: "2026-07-01", location_id: loc, participants: with_ });
    await create("/api/ties", { title: "Not matched", tie_type: "floor", tie_date: "2026-05-01", location_id: loc, participants: with_ });

    expect(await titles({ person_ids: [sam], location_ids: [loc], from: "2026-04-01", to: "2026-06-01", match_ids: [right, wrongDate] }))
      .toEqual(["Right"]);
    expect(await titles({ location_ids: [loc], match_ids: [] })).toEqual([]);
    expect((await titles({ location_ids: [loc] })).sort()).toEqual(["Not matched", "Right", "Wrong date"]);
  });

  it("refuses a keyword: it's searched for on the device and never sent", async () => {
    expect((await search({ q: "secret" })).status).toBe(400);
  });

  it("gives the device every tie's title, notes (still encrypted) and plan titles to search", async () => {
    const plan = await create("/api/plans", { title: "Zebra harness" });
    const tie = await create("/api/ties", { tie_type: "floor", tie_date: "2026-01-01", title: "Indexed", notes: sealed("zebra notes"), plan_ids: [plan] });
    const index = (await call("/api/ties/search-index")).body;
    expect(index.find((/** @type {any} */ e) => e.id === tie)).toEqual({
      id: tie, title: "Indexed", notes: sealed("zebra notes"), plan_titles: ["Zebra harness"],
    });
    expect(index.every((/** @type {any} */ e) => Array.isArray(e.plan_titles))).toBe(true);
  });

  it("never matches or indexes another user's ties", async () => {
    const otherId = await createOtherUser();
    await sql("INSERT INTO locations (id, owner_id, name) VALUES ('their-spot', ?, 'Their spot')", otherId).run();
    await sql("INSERT INTO ties (id, owner_id, title, tie_date, tie_type, location_id) VALUES ('their-tie', ?, 'Secret mango', '2026-01-01', 'floor', 'their-spot')", otherId).run();

    expect(await titles({ location_ids: ["their-spot"] })).toEqual([]);
    expect(await titles({ match_ids: ["their-tie"] })).toEqual([]);
    expect((await call("/api/ties/search-index")).body.map((/** @type {any} */ e) => e.id)).not.toContain("their-tie");
  });

  it("saves notes only encrypted", async () => {
    const res = await call("/api/ties", { method: "POST", body: { tie_type: "floor", tie_date: "2026-01-01", title: "Plain", notes: "plain notes" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/weren't encrypted/);
  });

  it("rejects bad filters with a friendly message", async () => {
    expect(await search({ from: "2026-05-01", to: "2026-04-01" }))
      .toEqual({ status: 400, body: { error: "The start date is after the end date." } });
    expect((await search({ from: "2026-02-30" })).status).toBe(400);
    expect((await search({ page: 0 })).body.error).toBe("Page should be a whole number, 1 or more.");
    expect((await search({ person_ids: "sam" })).body.error).toBe("Choose people as a list.");
    expect((await call("/api/ties/search", { method: "POST", body: "not json" })).status).toBe(400);
  });

  it("is only a POST", async () => {
    expect((await call("/api/ties?q=secret")).status).toBe(404);
    expect((await call("/api/ties/search?q=secret")).status).toBe(404);
  });
});

describe("paging ties", () => {
  it("returns 20 per page, newest tie date first, with the total", async () => {
    const loc = await create("/api/locations", { name: "Paging" });
    // 25 ties, one on each of March 1–25.
    for (let day = 1; day <= 25; day++) {
      await create("/api/ties", { title: `Day ${day}`, tie_type: "floor", tie_date: `2026-03-${String(day).padStart(2, "0")}`, location_id: loc });
    }

    const page1 = (await search({ location_ids: [loc] })).body;
    const page2 = (await search({ location_ids: [loc], page: 2 })).body;
    const page3 = (await search({ location_ids: [loc], page: 3 })).body;

    expect(page1).toMatchObject({ total: 25, page: 1, page_size: 20 });
    expect(page1.ties.map((/** @type {any} */ t) => t.title).slice(0, 3)).toEqual(["Day 25", "Day 24", "Day 23"]);
    expect(page1.ties).toHaveLength(20);
    expect(page2.ties.map((/** @type {any} */ t) => t.title)).toEqual(["Day 5", "Day 4", "Day 3", "Day 2", "Day 1"]);
    expect(page3).toMatchObject({ ties: [], total: 25, page: 3 });
  });

  it("orders ties on the same date by when they were logged, newest first", async () => {
    const loc = await create("/api/locations", { name: "Same day" });
    const first = await create("/api/ties", { title: "First", tie_type: "floor", tie_date: "2026-04-01", location_id: loc });
    const second = await create("/api/ties", { title: "Second", tie_type: "floor", tie_date: "2026-04-01", location_id: loc });
    await sql("UPDATE ties SET created_at = '2026-04-01T10:00:00Z' WHERE id = ?", first).run();
    await sql("UPDATE ties SET created_at = '2026-04-01T11:00:00Z' WHERE id = ?", second).run();

    expect(await titles({ location_ids: [loc] })).toEqual(["Second", "First"]);
  });

  it("includes each tie's participants and plans on later pages", async () => {
    const loc = await create("/api/locations", { name: "Page two links" });
    const sam = await create("/api/people", { name: "Sam" });
    const plan = await create("/api/plans", { title: "Box tie" });
    await create("/api/ties", {
      title: "Oldest", tie_type: "floor", tie_date: "2020-01-01", location_id: loc,
      participants: [{ person_id: sam, role: "bottom" }], plan_ids: [plan],
    });
    for (let i = 0; i < 20; i++) await create("/api/ties", { title: `New ${i}`, tie_type: "floor", tie_date: "2026-01-01", location_id: loc });

    const [oldest] = (await search({ location_ids: [loc], page: 2 })).body.ties;
    expect(oldest.title).toBe("Oldest");
    expect(oldest.participants).toEqual([{ id: expect.any(String), person_id: sam, person_name: "Sam", role: "bottom" }]);
    expect(oldest.plans).toEqual([{ id: expect.any(String), plan_id: plan, plan_title: "Box tie", plan_version: 1 }]);
  });
});

describe("the list's order, page size and counts", () => {
  it("sorts newest or oldest first, pages 20, 50 or 100 at a time, and counts all my ties", async () => {
    // A user of its own, so all_total counts only these ties.
    const cookie = await sessionCookieFor(await createOtherUser());
    /** @param {Record<string, unknown>} body */
    const list = async (body) => (await call("/api/ties/search", { method: "POST", body, cookie })).body;
    for (let day = 1; day <= 25; day++) {
      const tie_date = `2026-03-${String(day).padStart(2, "0")}`;
      await call("/api/ties", { method: "POST", body: { title: `Day ${day}`, tie_type: "floor", tie_date, tags: day === 1 ? ["first", "Alpha"] : [] }, cookie });
    }

    const newest = await list({});
    expect([newest.ties.length, newest.page_size, newest.ties[0].title]).toEqual([20, 20, "Day 25"]);
    const oldest = await list({ sort: "oldest" });
    expect(oldest.ties.slice(0, 2).map((/** @type {any} */ t) => t.title)).toEqual(["Day 1", "Day 2"]);
    // Tags come with each tie, A–Z ignoring capitals.
    expect(oldest.ties[0].tags).toEqual(["Alpha", "first"]);
    expect(oldest.ties[1].tags).toEqual([]);
    expect((await list({ page_size: 50 })).ties).toHaveLength(25);
    expect((await list({ sort: "oldest", page: 2 })).ties.map((/** @type {any} */ t) => t.title)).toEqual(
      ["Day 21", "Day 22", "Day 23", "Day 24", "Day 25"]);

    const filtered = await list({ from: "2026-03-20" });
    expect([filtered.total, filtered.all_total]).toEqual([6, 25]);
    expect((await call("/api/ties/search", { method: "POST", body: { page_size: 30 }, cookie })).status).toBe(400);
  });

  it("puts same-day ties in exactly the reverse order when sorted oldest first", async () => {
    const cookie = await sessionCookieFor(await createOtherUser());
    for (const title of ["A", "B", "C"]) {
      await call("/api/ties", { method: "POST", body: { title, tie_type: "floor", tie_date: "2026-04-01" }, cookie });
    }
    /** @param {string} sort */
    const titles = async (sort) => (await call("/api/ties/search", { method: "POST", body: { sort }, cookie })).body.ties.map((/** @type {any} */ t) => t.title);
    expect(await titles("oldest")).toEqual([...(await titles("newest"))].reverse());
  });
});
