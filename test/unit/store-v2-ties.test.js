// The v2 store's ties and Analytics (store/v2/ties.js, stats.js) over a
// journal in memory: v1's functions and results, the keyword searched in
// memory.
import { describe, it, expect, vi, beforeEach } from "vitest";

/** @type {Map<string, any>} */
const journal = new Map();
/** @type {any[]} */
const saved = [];
vi.mock("../../public/js/store/v2/journal.js", () => ({
  records: (/** @type {string} */ kind) => [...journal.values()].filter((r) => r.kind === kind && r.body),
  record: (/** @type {string} */ id) => journal.get(id) ?? null,
  byId: () => new Map(journal),
  save: async (/** @type {any} */ batch) => {
    saved.push(batch);
    for (const w of batch.writes ?? []) journal.set(w.id, { kind: w.kind, id: w.id, version: 1, body: w.body });
    for (const d of batch.deletes ?? []) journal.delete(d.id);
  },
}));
// By a path in a variable: they load page modules the Node type check can't follow.
const TIES = "../../public/js/store/v2/ties.js";
const STATS = "../../public/js/store/v2/stats.js";
/** @type {Record<"findTies" | "getTie" | "saveTie" | "deleteTie" | "recentOnTies", (...args: any[]) => Promise<any>>} */
const ties = await import(TIES);
/** @type {{ statsTies: (filters: Record<string, unknown>) => Promise<any[]> }} */
const stats = await import(STATS);

/** @param {string} kind @param {string} id @param {Record<string, any>} body */
const put = (kind, id, body) => journal.set(id, { kind, id, version: 1, body });

beforeEach(() => {
  journal.clear();
  saved.length = 0;
  put("person", "me", { name: "Me", is_self: true });
  put("location", "studio", { name: "Studio" });
  put("tag", "box", { name: "Box" });
});

describe("the v2 ties store", () => {
  it("saves a tie with its tags, new ones made in the same batch, and gets it back as the list has it", async () => {
    const id = await ties.saveTie(null, { title: "Session", tie_date: "2026-11-14", tie_type: "floor", location_id: "studio",
      participants: [{ person_id: "me", role: "top" }], tags: ["box", "Ebi"] });
    expect(saved[0].writes.map((/** @type {any} */ w) => w.kind)).toEqual(["tag", "tie"]);
    expect(await ties.getTie(id)).toMatchObject({ title: "Session", location_name: "Studio", tags: ["Box", "Ebi"],
      participants: [{ person_name: "Me", role: "top" }] });
    await ties.saveTie(id, { title: "Session 2", tie_date: "2026-11-14", tie_type: "floor", tags: [] });
    expect(saved[1].writes[0].from).toMatchObject({ title: "Session" });
    expect((await ties.getTie(id)).location_name).toBeNull();
  });

  it("finds ties by a keyword in their notes, in memory, with the other filters", async () => {
    put("tie", "a", { tie_date: "2026-01-01", tie_type: "floor", notes: "Hip harness", location_id: "studio" });
    put("tie", "b", { tie_date: "2026-02-01", tie_type: "floor", notes: "Chest harness" });
    put("tie", "c", { tie_date: "2026-03-01", tie_type: "floor", title: "Other" });
    const found = await ties.findTies({ q: "harness" });
    expect([found.ties.map((/** @type {any} */ t) => t.id), found.matched, found.total, found.all_total]).toEqual([["b", "a"], ["a", "b"], 2, 3]);
    expect((await ties.findTies({ q: "harness", location_ids: ["studio"] })).ties.map((/** @type {any} */ t) => t.id)).toEqual(["a"]);
    expect((await ties.findTies({ ids: ["c", "a"] })).ties.map((/** @type {any} */ t) => t.id)).toEqual(["c", "a"]);
  });

  it("deletes a tie with its drawings, freeing its files", async () => {
    put("tie", "t", { tie_date: "2026-01-01", tie_type: "floor", visuals: [{ kind: "file", id: "f1" }, { kind: "drawing", id: "d1" }] });
    put("drawing", "d1", { data: { v: 1, strokes: [] } });
    await ties.deleteTie("t");
    expect(saved[0].deletes).toEqual([{ kind: "drawing", id: "d1" }, { kind: "tie", id: "t", files: ["f1"] }]);
    await expect(ties.getTie("t")).rejects.toThrow(/Not found/);
  });

  it("gives the recent pickers and Analytics' ties", async () => {
    put("tie", "t", { tie_date: "2026-01-01", tie_type: "floor", location_id: "studio", participants: [{ person_id: "me", role: "bottom" }] });
    expect(await ties.recentOnTies("locations")).toEqual(["studio"]);
    expect((await stats.statsTies({ role: "bottom" })).map((t) => t.id)).toEqual(["t"]);
    expect(await stats.statsTies({ role: "top" })).toEqual([]);
  });
});
