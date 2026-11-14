// Plans and tags in format 2: the plan form's record (records/edits.js),
// tags matched and made (records/tags.js), deleting a plan or tag, and the
// rows the pages get (store/queries/plans.js, tags.js) with format 1's
// columns and order.
import { describe, it, expect } from "vitest";
import { planBody, planDeleted } from "../../public/js/records/edits.js";
import { tagNames, linkTags, tagDeleted } from "../../public/js/records/tags.js";
import { listPlans } from "../../public/js/store/queries/plans.js";
import { listTags } from "../../public/js/store/queries/tags.js";
import { recordProblems } from "../../public/js/records/schema.js";
import { RESOURCES } from "../../src/resources/config.js";

const NOW = "2026-11-14T12:00:00Z";
const LATER = "2026-11-15T09:00:00Z";
/** @param {string} kind @param {string} id @param {Record<string, any>} body */
const entry = (kind, id, body) => ({ kind, id, version: 1, body });

/**
 * The column names in a SELECT list, subqueries' aliases included.
 * @param {string} columns
 */
function columnNames(columns) {
  const names = [];
  let depth = 0;
  let current = "";
  for (const c of columns) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      names.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  names.push(current);
  return names.map((n) => n.trim()).map((n) => n.match(/\bAS\s+(\w+)$/)?.[1] ?? n);
}

describe("tags", () => {
  it("read names as the server does: trimmed, blanks out, the same name ignoring capitals once", () => {
    expect(tagNames([" Futomomo ", "", "futomomo", "Box"])).toEqual(["Futomomo", "Box"]);
    expect(() => tagNames(["x".repeat(41)])).toThrow(/40 characters/);
    expect(() => tagNames(Array.from({ length: 31 }, (_, i) => `t${i}`))).toThrow(/up to 30/);
  });

  it("link the tags I have, ignoring capitals, and make the new ones once", () => {
    let n = 0;
    const tags = [entry("tag", "t-box", { name: "Box" })];
    const { ids, writes } = linkTags(tags, ["box", "Ebi", "EBI"], NOW, () => `new-${++n}`);
    expect(ids).toEqual(["t-box", "new-1"]);
    expect(writes).toEqual([{ kind: "tag", id: "new-1", body: { name: "Ebi", created_at: NOW, updated_at: NOW } }]);
  });

  it("come off every tie, plan and workshop when deleted", () => {
    const items = [entry("tie", "a", { tags: ["x", "y"] }), entry("plan", "b", { tags: ["y"] }), entry("workshop", "c", { tags: ["x"] })];
    expect(tagDeleted("x", items, NOW).map((w) => [w.id, w.body.tags])).toEqual([["a", ["y"]], ["c", []]]);
  });

  it("list most recently used on a tie first, then the rest by name, with counts", () => {
    const tags = ["old", "new", "plan-only", "Alpha"].map((id) => entry("tag", id, { name: id }));
    const ties = [
      entry("tie", "t1", { tie_date: "2026-01-01", created_at: NOW, tags: ["old"] }),
      entry("tie", "t2", { tie_date: "2026-03-01", created_at: NOW, tags: ["new", "old"] }),
    ];
    // "old" is on the newest tie too, so it ties with "new": by name then.
    const rows = listTags({ tags, ties, plans: [entry("plan", "p", { tags: ["plan-only"] })], workshops: [] });
    expect(rows.map((r) => [r.name, r.tie_count, r.plan_count])).toEqual([
      ["new", 1, 0], ["old", 2, 0], ["Alpha", 0, 0], ["plan-only", 0, 1],
    ]);
  });
});

describe("planBody", () => {
  it("makes a plan from the form, with its tags, stage and type", () => {
    const body = planBody({ title: " TK ", description: "", est_difficulty: "3", plan_type: "", tie_type: "floor" }, null,
      { id: "p1", tagIds: ["t1"], plans: [], now: NOW });
    expect(body).toEqual({ title: "TK", stage: "idea", est_difficulty: 3, plan_type: "idea", tie_type: "floor", tags: ["t1"],
      version: 1, created_at: NOW, updated_at: NOW });
    expect(recordProblems("plan", body, { id: "p1" })).toEqual([]);
  });

  it("keeps its stage, visuals and creation; a variation of another of mine, not itself", () => {
    const prev = { title: "TK", stage: "ready", visuals: [{ kind: "drawing", id: "d1" }], created_at: NOW };
    const plans = [entry("plan", "p1", prev), entry("plan", "p2", { title: "Other" })];
    const edited = planBody({ title: "TK 2", stage: "idea", variation_of: "p2" }, prev, { id: "p1", tagIds: [], plans, now: LATER });
    expect(edited).toMatchObject({ title: "TK 2", stage: "ready", visuals: prev.visuals, variation_of: "p2", created_at: NOW, updated_at: LATER });
    expect(edited.tags).toBeUndefined();
    expect(() => planBody({ title: "X", variation_of: "p1" }, prev, { id: "p1", tagIds: [], plans, now: LATER })).toThrow(/itself/);
    expect(() => planBody({ title: "X", variation_of: "nope" }, null, { id: "p3", tagIds: [], plans, now: LATER })).toThrow(/not found/);
    expect(() => planBody({ title: "" }, null, { id: "p3", tagIds: [], plans, now: LATER })).toThrow("Give the plan a title.");
  });

  it("can be added already archived", () => {
    expect(planBody({ title: "Once", archive_now: true }, null, { id: "p", tagIds: [], plans: [], now: NOW }).archived_at).toBe(NOW);
  });
});

describe("planDeleted", () => {
  const plan = entry("plan", "p1", { title: "TK", visuals: [{ kind: "file", id: "f1" }, { kind: "drawing", id: "d1" }, { kind: "pose", id: "q1" }] });
  const others = [
    entry("tie", "t1", { plans: [{ plan_id: "p1", plan_version: 1 }, { plan_id: "p9", plan_version: 1 }] }),
    entry("tie", "t2", { plans: [{ plan_id: "p9", plan_version: 1 }] }),
    entry("plan", "p2", { title: "TK 2", variation_of: "p1" }),
  ];

  it("takes it off its ties, or leaves them showing it deleted", () => {
    expect(planDeleted(plan, others, "remove", NOW).writes.map((w) => [w.id, w.body.plans ?? w.body.variation_of])).toEqual([
      ["t1", [{ plan_id: "p9", plan_version: 1 }]], ["p2", undefined],
    ]);
    expect(planDeleted(plan, others, "keep", NOW).writes[0].body.plans).toEqual([{ plan_id: null, plan_version: 1 }, { plan_id: "p9", plan_version: 1 }]);
  });

  it("deletes its drawings and poses with it, and frees its files", () => {
    expect(planDeleted(plan, others, "keep", NOW).deletes).toEqual([
      { kind: "drawing", id: "d1" }, { kind: "pose", id: "q1" }, { kind: "plan", id: "p1", files: ["f1"] },
    ]);
  });

  it("needs the linked ties' choice", () => {
    expect(() => planDeleted(plan, others, /** @type {any} */ ("maybe"), NOW)).toThrow(/linked ties/);
  });
});

describe("plan rows", () => {
  it("have exactly format 1's columns", () => {
    const [row] = listPlans({ plans: [entry("plan", "p", { title: "T" })], ties: [], tags: [], workshops: [] }, "all");
    expect(Object.keys(row)).toEqual(columnNames(RESOURCES.plans.columns));
  });

  it("list last changed first, with tags A–Z, linked ties newest first, the workshop and the visuals counted", () => {
    const plans = [
      entry("plan", "p1", { title: "Older", updated_at: NOW, tags: ["tb", "ta"], workshop_id: "w1",
        visuals: [{ kind: "file", id: "f" }, { kind: "drawing", id: "d" }] }),
      entry("plan", "p2", { title: "Newer", updated_at: LATER, archived_at: NOW }),
    ];
    const ties = [
      entry("tie", "t1", { title: "First", tie_date: "2026-01-01", plans: [{ plan_id: "p1" }] }),
      entry("tie", "t2", { title: "Second", tie_date: "2026-02-01", success_rating: 4, plans: [{ plan_id: "p1" }, { plan_id: "p1" }] }),
    ];
    const tags = [entry("tag", "ta", { name: "box" }), entry("tag", "tb", { name: "Ankle" })];
    const all = listPlans({ plans, ties, tags, workshops: [entry("workshop", "w1", { title: "Intro" })] }, "all");
    expect(all.map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(all[1]).toMatchObject({ tags: ["Ankle", "box"], workshop_title: "Intro", photo_count: 1, visual_count: 2, version: 1,
      linked_ties: [{ id: "t2", title: "Second", tie_date: "2026-02-01", success_rating: 4 }, { id: "t1", title: "First", tie_date: "2026-01-01", success_rating: null }] });
    expect(listPlans({ plans, ties, tags, workshops: [] }, false).map((p) => p.id)).toEqual(["p1"]);
  });
});
