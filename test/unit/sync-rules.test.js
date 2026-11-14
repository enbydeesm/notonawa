// The sync rules (public/js/cache/sync-rules.js): applying a sync page, and
// carrying a stale edit onto a newer version.
import { describe, it, expect } from "vitest";
import { planPage, mergeEdit, same } from "../../public/js/cache/sync-rules.js";

/** @param {string} id @param {number} version @param {number} seq */
const write = (id, version, seq) => ({ id, kind: "tie", seq, deleted: false, version, key: `k${version}`, body: `b${version}` });
/** @param {string} id @param {number} seq */
const gone = (id, seq) => ({ id, kind: "tie", seq, deleted: true, version: null, key: null, body: null });

describe("planPage", () => {
  it("stores new records and newer versions, remembering the highest seen", () => {
    const plan = planPage([write("a", 1, 1), write("b", 3, 2)], new Map([["b", { id: "b", version: 2, deleted: false }]]));
    expect(plan.puts.map((r) => [r.id, r.version, r.seq])).toEqual([["a", 1, 1], ["b", 3, 2]]);
    expect(plan.seen).toEqual([{ id: "a", version: 1, deleted: false }, { id: "b", version: 3, deleted: false }]);
    expect([plan.removes, plan.refused]).toEqual([[], []]);
  });

  it("refuses an older version than one seen, keeping what's cached", () => {
    const plan = planPage([write("a", 2, 5)], new Map([["a", { id: "a", version: 3, deleted: false }]]));
    expect([plan.puts, plan.seen, plan.refused]).toEqual([[], [], ["a"]]);
  });

  it("takes the same version again (a page fetched twice)", () => {
    expect(planPage([write("a", 3, 5)], new Map([["a", { id: "a", version: 3, deleted: false }]])).puts).toHaveLength(1);
  });

  it("removes a deleted record and remembers it for good: it can't come back", () => {
    const plan = planPage([write("a", 1, 1), gone("a", 2), write("a", 2, 3)], new Map());
    expect([plan.puts, plan.removes, plan.refused]).toEqual([[], ["a"], ["a"]]);
    expect(plan.seen).toEqual([{ id: "a", version: 1, deleted: true }]);
    expect(planPage([write("b", 1, 9)], new Map([["b", { id: "b", version: 0, deleted: true }]])).refused).toEqual(["b"]);
  });

  it("keeps the last change to an id in the page", () => {
    const plan = planPage([write("a", 1, 1), write("a", 2, 2)], new Map());
    expect(plan.puts.map((r) => r.version)).toEqual([2]);
  });
});

describe("mergeEdit", () => {
  const base = { title: "Ebi", notes: "old", rating: 3, tags: ["a"] };

  it("keeps the fields I changed and takes the others from the newer version", () => {
    const mine = { ...base, title: "Ebi 2" };
    const theirs = { ...base, notes: "new", rating: 4 };
    expect(mergeEdit(base, mine, theirs)).toEqual({ title: "Ebi 2", notes: "new", rating: 4, tags: ["a"] });
  });

  it("lets mine win where both changed a field, lists included", () => {
    expect(mergeEdit(base, { ...base, tags: ["b"] }, { ...base, tags: ["c"] }).tags).toEqual(["b"]);
  });

  it("removes a field I removed, and keeps one only they added", () => {
    const { notes: _gone, ...mine } = base;
    expect(mergeEdit(base, mine, { ...base, cover: "x" })).toEqual({ title: "Ebi", rating: 3, tags: ["a"], cover: "x" });
  });
});

describe("same", () => {
  it("compares JSON values, object keys in any order", () => {
    expect(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(same([1], { 0: 1 })).toBe(false);
    expect(same(null, {})).toBe(false);
  });
});
