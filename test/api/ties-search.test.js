import { describe, it, expect } from "vitest";
import { call, create, createOtherUser, sql } from "../helpers.js";

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
      title, tie_date: "2026-01-01", participants: people.map((person_id) => ({ person_id, role: "model" })),
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
    await create("/api/ties", {
      title: "Switch", participants: [{ person_id: sam, role: "rigger" }, { person_id: sam, role: "model" }],
    });
    expect(await titles({ person_ids: [sam] })).toEqual(["Switch"]);
    // Sam twice doesn't count as Sam and Alex.
    expect(await titles({ person_ids: [sam, alex] })).toEqual([]);
  });

  it("by location: ties at any of the chosen locations", async () => {
    const a = await create("/api/locations", { name: "A" });
    const b = await create("/api/locations", { name: "B" });
    const c = await create("/api/locations", { name: "C" });
    await create("/api/ties", { title: "At A", tie_date: "2026-01-03", location_id: a });
    await create("/api/ties", { title: "At B", tie_date: "2026-01-02", location_id: b });
    await create("/api/ties", { title: "At C", tie_date: "2026-01-01", location_id: c });

    expect(await titles({ location_ids: [a, b] })).toEqual(["At A", "At B"]);
  });

  it("by tie date, from and to inclusive", async () => {
    const loc = await create("/api/locations", { name: "Dates" });
    for (const [title, tie_date] of [["Jan", "2025-01-15"], ["Feb", "2025-02-01"], ["Mar", "2025-03-31"], ["Undated", null]]) {
      await create("/api/ties", { title, tie_date, location_id: loc });
    }
    const at = { location_ids: [loc] };
    expect(await titles({ ...at, from: "2025-02-01", to: "2025-03-31" })).toEqual(["Mar", "Feb"]);
    expect(await titles({ ...at, from: "2025-02-02" })).toEqual(["Mar"]);
    expect(await titles({ ...at, to: "2025-01-15" })).toEqual(["Jan"]);
    // No date filter: undated ties are listed, after the dated ones.
    expect(await titles(at)).toEqual(["Mar", "Feb", "Jan", "Undated"]);
  });

  it("by keyword in the title, notes or a linked plan's title, ignoring case", async () => {
    const plan = await create("/api/plans", { title: "Zebra harness" });
    await create("/api/ties", { title: "zebra in title" });
    await create("/api/ties", { title: "Notes match", notes: "tried the ZEBRA wrap" });
    await create("/api/ties", { title: "Plan match", plan_ids: [plan] });
    await create("/api/ties", { title: "No match", notes: "zebr a" });

    expect((await titles({ q: "Zebra" })).sort()).toEqual(["Notes match", "Plan match", "zebra in title"]);
    expect(await titles({ q: "  zebra wrap " })).toEqual(["Notes match"]);
  });

  it("treats % and _ in the keyword as plain characters", async () => {
    await create("/api/ties", { title: "100% fun" });
    await create("/api/ties", { title: "1000 fun" });
    await create("/api/ties", { title: "snake_case tie" });
    await create("/api/ties", { title: "snakeXcase tie" });

    expect(await titles({ q: "100%" })).toEqual(["100% fun"]);
    expect(await titles({ q: "snake_case" })).toEqual(["snake_case tie"]);
  });

  it("combines filters", async () => {
    const sam = await create("/api/people", { name: "Sam" });
    const loc = await create("/api/locations", { name: "Combo" });
    const with_ = [{ person_id: sam, role: "model" }];
    await create("/api/ties", { title: "Right", notes: "kiwi", tie_date: "2026-05-01", location_id: loc, participants: with_ });
    await create("/api/ties", { title: "Wrong date", notes: "kiwi", tie_date: "2026-07-01", location_id: loc, participants: with_ });
    await create("/api/ties", { title: "No Sam", notes: "kiwi", tie_date: "2026-05-01", location_id: loc });
    await create("/api/ties", { title: "Missing keyword", tie_date: "2026-05-01", location_id: loc, participants: with_ });

    expect(await titles({ person_ids: [sam], location_ids: [loc], from: "2026-04-01", to: "2026-06-01", q: "kiwi" })).toEqual(["Right"]);
  });

  it("never matches another user's ties", async () => {
    const otherId = await createOtherUser();
    await sql("INSERT INTO locations (id, owner_id, name) VALUES ('their-spot', ?, 'Their spot')", otherId).run();
    await sql("INSERT INTO ties (id, owner_id, title, location_id) VALUES ('their-tie', ?, 'Secret mango', 'their-spot')", otherId).run();

    expect(await titles({ location_ids: ["their-spot"] })).toEqual([]);
    expect(await titles({ q: "mango" })).toEqual([]);
  });

  it("rejects bad filters with a friendly message", async () => {
    expect(await search({ from: "2026-05-01", to: "2026-04-01" }))
      .toEqual({ status: 400, body: { error: "The start date is after the end date." } });
    expect((await search({ from: "2026-02-30" })).status).toBe(400);
    expect((await search({ page: 0 })).body.error).toBe("Page should be a whole number, 1 or more.");
    expect((await search({ person_ids: "sam" })).body.error).toBe("Choose people as a list.");
    expect((await call("/api/ties/search", { method: "POST", body: "not json" })).status).toBe(400);
  });

  it("is only a POST, so the keyword never goes in a URL", async () => {
    expect((await call("/api/ties?q=secret")).status).toBe(404);
    expect((await call("/api/ties/search?q=secret")).status).toBe(404);
  });
});

describe("paging ties", () => {
  it("returns 20 per page, newest tie date first, with the total", async () => {
    const loc = await create("/api/locations", { name: "Paging" });
    // 25 ties, one on each of March 1–25.
    for (let day = 1; day <= 25; day++) {
      await create("/api/ties", { title: `Day ${day}`, tie_date: `2026-03-${String(day).padStart(2, "0")}`, location_id: loc });
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
    const first = await create("/api/ties", { title: "First", tie_date: "2026-04-01", location_id: loc });
    const second = await create("/api/ties", { title: "Second", tie_date: "2026-04-01", location_id: loc });
    await sql("UPDATE ties SET created_at = '2026-04-01T10:00:00Z' WHERE id = ?", first).run();
    await sql("UPDATE ties SET created_at = '2026-04-01T11:00:00Z' WHERE id = ?", second).run();

    expect(await titles({ location_ids: [loc] })).toEqual(["Second", "First"]);
  });

  it("includes each tie's participants and plans on later pages", async () => {
    const loc = await create("/api/locations", { name: "Page two links" });
    const sam = await create("/api/people", { name: "Sam" });
    const plan = await create("/api/plans", { title: "Box tie" });
    await create("/api/ties", {
      title: "Oldest", tie_date: "2020-01-01", location_id: loc,
      participants: [{ person_id: sam, role: "model" }], plan_ids: [plan],
    });
    for (let i = 0; i < 20; i++) await create("/api/ties", { title: `New ${i}`, tie_date: "2026-01-01", location_id: loc });

    const [oldest] = (await search({ location_ids: [loc], page: 2 })).body.ties;
    expect(oldest.title).toBe("Oldest");
    expect(oldest.participants).toEqual([{ person_id: sam, person_name: "Sam", role: "model" }]);
    expect(oldest.plans).toEqual([{ plan_id: plan, plan_title: "Box tie", plan_version: 1 }]);
  });
});
