// Workshops in format 2: the workshop form's record (records/edits.js),
// deleting and linking, the Education view's rows (store/queries/
// workshops.js) with format 1's columns and order, and the v2 store
// (store/v2/workshops.js) over a journal in memory. The cases format 1's
// test/api/workshops.test.js checks.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { workshopBody, workshopDeleted, linkedToWorkshop } from "../../public/js/records/edits.js";
import { listWorkshopsIn, workshopRow } from "../../public/js/store/queries/workshops.js";
import { recordProblems } from "../../public/js/records/schema.js";
import { WORKSHOP_COLUMNS } from "../../src/workshops/db.js";

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
// By a path in a variable: it loads page modules the Node type check can't follow.
const STORE = "../../public/js/store/v2/workshops.js";
/** @type {Record<"listWorkshops" | "getWorkshop" | "saveWorkshop" | "deleteWorkshop" | "linkToWorkshop", (...args: any[]) => Promise<any>>} */
const store = await import(STORE);

const NOW = "2026-11-14T12:00:00Z";
const LATER = "2026-11-15T09:00:00Z";
/** @param {string} kind @param {string} id @param {Record<string, any>} body */
const entry = (kind, id, body) => ({ kind, id, version: 1, body });
/** @param {string} kind @param {string} id @param {Record<string, any>} body */
const put = (kind, id, body) => journal.set(id, entry(kind, id, body));
const has = (/** @type {string} */ kind, /** @type {string} */ id) => {
  const e = journal.get(id);
  return e?.kind === kind ? e : null;
};
const BASE = { title: "Intro to suspension", start_date: "2026-11-14" };

beforeEach(() => {
  journal.clear();
  saved.length = 0;
  put("person", "kai", { name: "Kai", is_educator: true });
  put("person", "sam", { name: "Sam" });
  put("location", "studio", { name: "Studio" });
});

describe("workshopBody", () => {
  it("makes a workshop from the form, educators and participants as one list, and the kind's rules hold", () => {
    const body = workshopBody({ ...BASE, end_date: "2026-11-14", location_id: "studio", attendee_count: "12", rating: "5",
      cost: "USD 180.00", educators: [{ person_id: "kai", role: "top" }], participants: [{ person_id: "sam", role: "audit" }] },
    null, { tagIds: ["t"], has, now: NOW });
    expect(body).toEqual({ title: "Intro to suspension", start_date: "2026-11-14", location_id: "studio", attendee_count: 12, rating: 5,
      cost: "USD 180.00", people: [{ person_id: "kai", kind: "educator", role: "top" }, { person_id: "sam", kind: "participant", role: "audit" }],
      tags: ["t"], created_at: NOW, updated_at: NOW });
    expect(recordProblems("workshop", body)).toEqual([]);
  });

  it("refuses one without a title or start date, ending before it starts, someone on it twice, or links not mine", () => {
    const where = { tagIds: [], has, now: NOW };
    expect(() => workshopBody({ start_date: "2026-11-14" }, null, where)).toThrow("Add a title.");
    expect(() => workshopBody({ title: "X" }, null, where)).toThrow("Add a start date.");
    expect(() => workshopBody({ ...BASE, end_date: "2026-11-01" }, null, where)).toThrow(/before the start/);
    expect(() => workshopBody({ ...BASE, educators: [{ person_id: "kai", role: "top" }], participants: [{ person_id: "kai", role: "bottom" }] },
      null, where)).toThrow(/twice/);
    expect(() => workshopBody({ ...BASE, educators: [{ person_id: "nope", role: "top" }] }, null, where)).toThrow(/not found/);
    expect(() => workshopBody({ ...BASE, location_id: "sam" }, null, where)).toThrow(/not found/);
    expect(() => workshopBody({ ...BASE, attendee_count: "-1" }, null, where)).toThrow(/attendee count/);
  });

  it("keeps deleted people and a deleted location only when asked, and its visuals", () => {
    const prev = { ...BASE, created_at: NOW, location_deleted: true, visuals: [{ kind: "drawing", id: "d" }],
      people: [{ person_id: null, kind: "educator", role: "top" }, { person_id: null, kind: "participant", role: "bottom" }] };
    const kept = workshopBody({ ...BASE, keep_deleted: { people: ["w1"], location: true } }, prev, { tagIds: [], has, now: LATER });
    expect([kept.people, kept.location_deleted, kept.visuals, kept.created_at]).toEqual([
      [{ person_id: null, kind: "participant", role: "bottom" }], true, prev.visuals, NOW]);
    const dropped = workshopBody(BASE, prev, { tagIds: [], has, now: LATER });
    expect([dropped.people, dropped.location_deleted]).toEqual([undefined, undefined]);
  });

  it("unlinks its ties and plans when deleted, and frees its files", () => {
    const w = entry("workshop", "w1", { ...BASE, visuals: [{ kind: "file", id: "f" }] });
    const { writes, deletes } = workshopDeleted(w, [entry("tie", "t", { workshop_id: "w1", tie_date: "2026-11-14" }), entry("plan", "p", { title: "P" })], NOW);
    expect(writes.map((x) => [x.id, x.body.workshop_id])).toEqual([["t", undefined]]);
    expect(deletes).toEqual([{ kind: "workshop", id: "w1", files: ["f"] }]);
    expect(linkedToWorkshop(entry("plan", "p", { title: "P", workshop_id: "old" }), "w1", NOW).body.workshop_id).toBe("w1");
  });
});

describe("rows", () => {
  it("have exactly format 1's columns, and its people, tags and links", () => {
    const text = WORKSHOP_COLUMNS.replace(/^\s*SELECT/, "");
    /** @type {string[]} */
    const names = [];
    let depth = 0;
    let current = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (depth === 0 && text.startsWith("FROM", i)) break;
      if (c === "," && depth === 0) {
        names.push(current);
        current = "";
      } else {
        current += c;
      }
    }
    names.push(current);
    const columns = names.map((n) => n.trim()).map((n) => n.match(/\bAS\s+(\w+)$/)?.[1] ?? n.replace(/^\w+\./, ""));
    expect(Object.keys(workshopRow(entry("workshop", "w", BASE), new Map(), []))).toEqual([...columns, "educators", "participants", "tags", "linked"]);
  });

  it("list newest first, with people by name (deleted first), plans A–Z then ties oldest first", () => {
    put("tag", "t", { name: "suspension" });
    const workshops = [
      entry("workshop", "old", { ...BASE, start_date: "2026-01-01" }),
      entry("workshop", "new", { ...BASE, start_date: "2026-11-01", location_id: "studio", tags: ["t"],
        people: [{ person_id: "sam", kind: "participant", role: "bottom" }, { person_id: "kai", kind: "educator", role: "top" },
          { person_id: null, kind: "participant", role: "audit" }] }),
    ];
    const items = [
      entry("plan", "pb", { title: "b plan", workshop_id: "new" }), entry("plan", "pa", { title: "A plan", workshop_id: "new" }),
      entry("tie", "t2", { tie_date: "2026-11-03", workshop_id: "new" }), entry("tie", "t1", { tie_date: "2026-11-02", title: "First", workshop_id: "new" }),
    ];
    const [first, second] = listWorkshopsIn(workshops, items, new Map(journal));
    expect([first.id, second.id]).toEqual(["new", "old"]);
    expect(first).toMatchObject({ location_name: "Studio", tags: ["suspension"],
      educators: [{ id: "w1", person_id: "kai", person_name: "Kai", role: "top" }],
      participants: [{ id: "w2", person_id: null, person_name: null, role: "audit" }, { id: "w0", person_id: "sam", person_name: "Sam", role: "bottom" }],
      linked: [{ kind: "plan", id: "pa", title: "A plan", date: null }, { kind: "plan", id: "pb", title: "b plan", date: null },
        { kind: "tie", id: "t1", title: "First", date: "2026-11-02" }, { kind: "tie", id: "t2", title: null, date: "2026-11-03" }] });
  });
});

describe("the v2 workshops store", () => {
  it("adds and edits one, with its tags, and lists it", async () => {
    const id = await store.saveWorkshop(null, { ...BASE, educators: [{ person_id: "kai", role: "top" }], tags: ["Suspension"] });
    expect(saved[0].writes.map((/** @type {any} */ w) => w.kind)).toEqual(["tag", "workshop"]);
    await store.saveWorkshop(id, { ...BASE, title: "Renamed", tags: ["suspension"] });
    expect(await store.getWorkshop(id)).toMatchObject({ title: "Renamed", tags: ["Suspension"], educators: [] });
    expect((await store.listWorkshops()).map((/** @type {any} */ w) => w.id)).toEqual([id]);
  });

  it("links a tie, moving it from another workshop, and unlinks ties and plans when one is deleted", async () => {
    put("workshop", "w1", BASE);
    put("workshop", "w2", BASE);
    put("tie", "t", { tie_date: "2026-11-14", tie_type: "floor", workshop_id: "w2" });
    await store.linkToWorkshop("w1", { tie_id: "t" });
    expect(journal.get("t").body.workshop_id).toBe("w1");
    expect((await store.getWorkshop("w1")).linked.map((/** @type {any} */ l) => l.id)).toEqual(["t"]);
    await store.deleteWorkshop("w1");
    expect([journal.get("t").body.workshop_id, journal.has("w1")]).toEqual([undefined, false]);
    await expect(store.linkToWorkshop("w2", { plan_id: "nope" })).rejects.toThrow(/not found/);
    await expect(store.getWorkshop("t")).rejects.toThrow(/Not found/);
  });
});
