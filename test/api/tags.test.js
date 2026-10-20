import { describe, it, expect } from "vitest";
import { call, create, createOtherUser, sql } from "../helpers.js";

/** The names linked to a tie, A–Z. @param {string} tieId */
async function tieTagNames(tieId) {
  const { results } = await sql(
    "SELECT t.name FROM tie_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.tie_id = ? ORDER BY t.name", tieId
  ).all();
  return results.map((r) => r.name);
}

/** @param {string} name */
async function countTagsNamed(name) {
  return (await sql("SELECT COUNT(*) AS n FROM tags WHERE name = ? COLLATE NOCASE", name).first())?.n;
}

describe("saving a tie with tags", () => {
  it("creates new tags and links existing ones, ignoring capitals", async () => {
    const first = await create("/api/ties", { tie_type: "floor", tie_date: "2026-01-01", title: "First", tags: ["Futomomo", "Floor"] });
    expect(await tieTagNames(first)).toEqual(["Floor", "Futomomo"]);

    const second = await create("/api/ties", { tie_type: "floor", tie_date: "2026-01-01", title: "Second", tags: ["futomomo", "Suspension"] });
    expect(await tieTagNames(second)).toEqual(["Futomomo", "Suspension"]);
    expect(await countTagsNamed("futomomo")).toBe(1);
  });

  it("saves no tags if the tie fails", async () => {
    const res = await call("/api/ties", { method: "POST", body: { title: "x", tie_type: "floor", tie_date: "2026-01-01", tags: ["Never saved"], plan_ids: ["no-such-plan"] } });
    expect(res.status).toBe(400);
    expect(await countTagsNamed("Never saved")).toBe(0);
  });

  it("rejects bad tag lists", async () => {
    expect(await call("/api/ties", { method: "POST", body: { title: "x", tie_type: "floor", tie_date: "2026-01-01", tags: "Floor" } }))
      .toEqual({ status: 400, body: { error: "Tags should be a list of up to 30 tags." } });
  });
});

describe("GET /api/tags", () => {
  it("lists most recently used first (A–Z when it's the same tie), then unused A–Z, with tie counts", async () => {
    const old = await create("/api/ties", { title: "Old", tie_type: "floor", tie_date: "2020-01-01", tags: ["r-old", "r-both"] });
    const owner = (await sql("SELECT owner_id FROM ties WHERE id = ?", old).first())?.owner_id;
    await create("/api/ties", { title: "New", tie_type: "floor", tie_date: "2030-01-01", tags: ["r-new", "r-both"] });
    await create("/api/ties", { title: "Oldest", tie_type: "floor", tie_date: "2010-01-01", tags: ["r-oldest"] });
    // Same date as "New" but logged later, so it counts as more recent.
    await create("/api/ties", { title: "New, later", tie_type: "floor", tie_date: "2030-01-01", tags: ["r-later"] });
    await sql("INSERT INTO tags (id, owner_id, name) VALUES ('u-b', ?, 'r-unused-b'), ('u-a', ?, 'R-unused-a')", owner, owner).run();
    // created_at is to the second, so pin the order of the two 2030 ties.
    await sql("UPDATE ties SET created_at = '2030-01-01T10:00:00Z' WHERE title = 'New'").run();
    await sql("UPDATE ties SET created_at = '2030-01-01T11:00:00Z' WHERE title = 'New, later'").run();

    const tags = (await call("/api/tags")).body.filter((/** @type {any} */ t) => /^r-/i.test(t.name));
    expect(tags.map((/** @type {any} */ t) => t.name)).toEqual(
      ["r-later", "r-both", "r-new", "r-old", "r-oldest", "R-unused-a", "r-unused-b"]);
    expect(tags.find((/** @type {any} */ t) => t.name === "r-both").tie_count).toBe(2);
    expect(tags.find((/** @type {any} */ t) => t.name === "r-unused-b").tie_count).toBe(0);
  });
});

describe("DELETE /api/tags/:id", () => {
  it("deletes the tag and removes it from its ties", async () => {
    const tie = await create("/api/ties", { tie_type: "floor", tie_date: "2026-01-01", title: "x", tags: ["d-gone", "d-kept"] });
    const gone = (await call("/api/tags")).body.find((/** @type {any} */ t) => t.name === "d-gone");

    expect((await call(`/api/tags/${gone.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/api/tags/${gone.id}`, { method: "DELETE" })).status).toBe(404);
    expect(await tieTagNames(tie)).toEqual(["d-kept"]);
  });

  it("removes it from plans too", async () => {
    const plan = await create("/api/plans", { title: "Tagged", tags: ["p-gone", "p-kept"] });
    const gone = (await call("/api/tags")).body.find((/** @type {any} */ t) => t.name === "p-gone");
    expect(gone).toMatchObject({ tie_count: 0, plan_count: 1 });
    expect((await call(`/api/tags/${gone.id}`, { method: "DELETE" })).status).toBe(204);
    const tags = (await call("/api/plans?archived=all")).body.find((/** @type {any} */ p) => p.id === plan).tags;
    expect(tags).toEqual(["p-kept"]);
  });
});

describe("other users' tags", () => {
  it("can't be listed, deleted or linked", async () => {
    const otherId = await createOtherUser();
    await sql("INSERT INTO tags (id, owner_id, name) VALUES ('their-tag', ?, 'o-theirs')", otherId).run();

    expect((await call("/api/tags")).body.map((/** @type {any} */ t) => t.id)).not.toContain("their-tag");
    expect((await call("/api/tags/their-tag", { method: "DELETE" })).status).toBe(404);

    // The same name makes a tag of my own instead of linking theirs.
    const tie = await create("/api/ties", { tie_type: "floor", tie_date: "2026-01-01", title: "x", tags: ["o-theirs"] });
    const linked = await sql("SELECT tag_id FROM tie_tags WHERE tie_id = ?", tie).first();
    expect(linked?.tag_id).not.toBe("their-tag");
    expect((await sql("SELECT name FROM tags WHERE id = 'their-tag'").first())?.name).toBe("o-theirs");
  });
});
