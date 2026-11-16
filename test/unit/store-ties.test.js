// Ties in format 2: the tie form's record (records/edits.js's tieBody), the
// Ties search, rows, recent pickers and Analytics' ties
// (store/queries/ties.js), with the cases format 1's API tests check
// (test/api/ties.test.js, ties-search.test.js, stats.test.js), over records
// in memory.
import { describe, it, expect } from "vitest";
import { tieBody, itemDeletes, TYPE_NEEDED } from "../../public/js/records/edits.js";
import { readTieFilters, findTiesIn, tieRow, searchIndex, recentOn, statsRows } from "../../public/js/store/queries/ties.js";
import { matchingTies } from "../../public/js/search-match.js";
import { recordProblems } from "../../public/js/records/schema.js";
import { TIE_COLUMNS } from "../../src/ties/db.js";

const NOW = "2026-11-14T12:00:00Z";
const LATER = "2026-11-15T09:00:00Z";
/** @param {string} kind @param {string} id @param {Record<string, any>} body */
const entry = (kind, id, body) => ({ kind, id, version: 1, body });
/** @param {any[]} entries */
const journalOf = (entries) => new Map(entries.map((e) => [e.id, e]));
/** @param {Map<string, any>} journal */
const hasIn = (journal) => (/** @type {string} */ kind, /** @type {string} */ id) => {
  const e = journal.get(id);
  return e?.kind === kind ? e : null;
};
/** @param {string} id @param {string} date @param {Record<string, any>} [more] */
const tie = (id, date, more = {}) => entry("tie", id, { tie_date: date, tie_type: "floor", created_at: NOW, ...more });
/** @param {Record<string, any>} body */
const filters = (body = {}) => readTieFilters(body);

const people = [entry("person", "me", { name: "Me", is_self: true }), entry("person", "sam", { name: "Sam" }),
  entry("person", "alex", { name: "alex" }), entry("person", "old", { name: "Old", archived_at: NOW })];
const places = [entry("location", "studio", { name: "Studio", latitude: 51.5, longitude: -0.1 }), entry("location", "home", { name: "Home" })];
const plans = [entry("plan", "tk", { title: "TK", version: 3 }), entry("plan", "ebi", { title: "Ebi" })];
const tags = [entry("tag", "box", { name: "box" }), entry("tag", "floor", { name: "Floor" })];

describe("tieBody", () => {
  const journal = journalOf([...people, ...places, ...plans, ...tags]);

  it("makes a tie from the form, its plans at their versions, and the kind's rules hold", () => {
    const body = tieBody({ title: " Session ", tie_date: "2026-11-14", tie_type: "floor", duration_minutes: "90", success_rating: "4",
      location_id: "studio", participants: [{ person_id: "sam", role: "model" }, { person_id: "sam", role: "bottom" }], plan_ids: ["tk", "tk"] },
    null, { tagIds: ["box"], has: hasIn(journal), now: NOW });
    expect(body).toEqual({ title: "Session", tie_date: "2026-11-14", tie_type: "floor", duration_minutes: 90, success_rating: 4,
      location_id: "studio", participants: [{ person_id: "sam", role: "bottom" }], plans: [{ plan_id: "tk", plan_version: 3 }], tags: ["box"],
      created_at: NOW, updated_at: NOW });
    expect(recordProblems("tie", body)).toEqual([]);
  });

  it("needs a date and a type, and links only to what's mine", () => {
    const where = { tagIds: [], has: hasIn(journal), now: NOW };
    expect(() => tieBody({ tie_type: "floor" }, null, where)).toThrow("Add a date.");
    expect(() => tieBody({ tie_date: "2026-11-14" }, null, where)).toThrow(TYPE_NEEDED);
    for (const bad of [{ location_id: "nope" }, { participants: [{ person_id: "nope", role: "top" }] }, { plan_ids: ["studio"] }]) {
      expect(() => tieBody({ tie_date: "2026-11-14", tie_type: "floor", ...bad }, null, where)).toThrow(/not found/);
    }
    expect(() => tieBody({ tie_date: "2026-11-14", tie_type: "floor", participants: [{ person_id: "sam" }] }, null, where)).toThrow(/person and a role/);
  });

  it("keeps a person's entry and a plan's version when they stay, and its visuals", () => {
    const prev = { tie_date: "2026-11-14", tie_type: "floor", created_at: NOW, visuals: [{ kind: "drawing", id: "d1" }],
      participants: [{ person_id: "sam", role: "bottom", difficulty_rating: 4 }], plans: [{ plan_id: "tk", plan_version: 1 }] };
    const body = tieBody({ tie_date: "2026-11-15", tie_type: "floor", participants: [{ person_id: "sam", role: "bottom" }, { person_id: "alex", role: "top" }],
      plan_ids: ["tk", "ebi"] }, prev, { tagIds: [], has: hasIn(journal), now: LATER });
    expect(body).toMatchObject({ created_at: NOW, updated_at: LATER, visuals: prev.visuals,
      participants: [{ person_id: "sam", role: "bottom", difficulty_rating: 4 }, { person_id: "alex", role: "top" }],
      plans: [{ plan_id: "tk", plan_version: 1 }, { plan_id: "ebi", plan_version: 1 }] });
  });

  it("keeps deleted people, plans and a deleted location only when asked to", () => {
    const prev = { tie_date: "2026-11-14", tie_type: "floor", location_deleted: true,
      participants: [{ person_id: null, role: "bottom" }, { person_id: null, role: "top" }], plans: [{ plan_id: null, plan_version: 2 }] };
    const base = { tie_date: "2026-11-14", tie_type: "floor" };
    const where = { tagIds: [], has: hasIn(journal), now: LATER };
    const kept = tieBody({ ...base, keep_deleted: { participants: ["p1"], plans: ["l0"], location: true } }, prev, where);
    expect([kept.participants, kept.plans, kept.location_deleted]).toEqual([[{ person_id: null, role: "top" }], [{ plan_id: null, plan_version: 2 }], true]);
    const dropped = tieBody(base, prev, where);
    expect([dropped.participants, dropped.plans, dropped.location_deleted]).toEqual([undefined, undefined, undefined]);
  });

  it("goes with its drawings and poses, freeing its files", () => {
    expect(itemDeletes(tie("t1", "2026-11-14", { visuals: [{ kind: "file", id: "f1" }, { kind: "pose", id: "q1" }] })))
      .toEqual([{ kind: "pose", id: "q1" }, { kind: "tie", id: "t1", files: ["f1"] }]);
  });
});

describe("rows", () => {
  // The SELECT list up to its own FROM (not a subquery's), split on its
  // top-level commas: each column's alias or name.
  const columns = (() => {
    const text = TIE_COLUMNS.replace(/^\s*SELECT/, "");
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
    return names.map((n) => n.trim()).map((n) => n.match(/\bAS\s+(\w+)$/)?.[1] ?? n.replace(/^\w+\./, ""));
  })();

  it("have exactly format 1's columns, and its people, plans and tags", () => {
    const journal = journalOf([...people, ...places, ...plans, ...tags]);
    expect(Object.keys(tieRow(tie("t", "2026-11-14"), journal))).toEqual([...columns, "participants", "plans", "tags"]);
  });

  it("name the location, workshop, people (deleted ones first, no name), plans and tags; archived ones still show", () => {
    const t = tie("t1", "2026-11-14", { location_id: "studio", workshop_id: "w1", tags: ["floor", "box", "gone"],
      participants: [{ person_id: "sam", role: "bottom" }, { person_id: null, role: "spotter" }, { person_id: "old", role: "top" }],
      plans: [{ plan_id: "tk", plan_version: 1 }, { plan_id: "deleted-plan", plan_version: 2 }], visuals: [{ kind: "file", id: "f" }, { kind: "pose", id: "p" }] });
    const row = tieRow(t, journalOf([...people, ...places, ...plans, ...tags, entry("workshop", "w1", { title: "Intro" })]));
    expect(row).toMatchObject({ location_id: "studio", location_name: "Studio", location_deleted: 0, workshop_title: "Intro",
      photo_count: 1, visual_count: 2, tags: ["box", "Floor"] });
    expect(row.participants).toEqual([{ id: "p1", person_id: null, person_name: null, role: "spotter" },
      { id: "p2", person_id: "old", person_name: "Old", role: "top" }, { id: "p0", person_id: "sam", person_name: "Sam", role: "bottom" }]);
    expect(row.plans).toEqual([{ id: "l1", plan_id: null, plan_title: null, plan_version: 2 }, { id: "l0", plan_id: "tk", plan_title: "TK", plan_version: 1 }]);
    expect(tieRow(tie("t2", "2026-11-14", { location_deleted: true }), new Map())).toMatchObject({ location_id: null, location_deleted: 1 });
  });
});

describe("the Ties search", () => {
  const ties = [
    tie("a", "2026-01-01", { title: "Futomomo", participants: [{ person_id: "sam", role: "bottom" }], location_id: "studio", tags: ["box"] }),
    tie("b", "2026-02-01", { participants: [{ person_id: "sam", role: "bottom" }, { person_id: "alex", role: "top" }], location_id: "home", tags: ["box", "floor"],
      plans: [{ plan_id: "tk" }] }),
    tie("c", "2026-03-01", { notes: "Hip harness", participants: [{ person_id: "alex", role: "top" }, { person_id: "alex", role: "spotter" }] }),
  ];
  const journal = journalOf([...people, ...places, ...plans, ...tags, ...ties]);
  /** @param {Record<string, any>} body */
  const ids = (body) => findTiesIn(ties, journal, filters(body)).ties.map((t) => t.id);

  it("by people: ties with all of them, a person in two roles counted once", () => {
    expect(ids({ person_ids: ["sam", "alex"] })).toEqual(["b"]);
    expect(ids({ person_ids: ["alex"] })).toEqual(["c", "b"]);
  });

  it("by location: any; by tags: any, or all", () => {
    expect(ids({ location_ids: ["studio", "home"] })).toEqual(["b", "a"]);
    expect(ids({ tag_ids: ["box", "floor"] })).toEqual(["b", "a"]);
    expect(ids({ tag_ids: ["box", "floor"], tag_match: "all" })).toEqual(["b"]);
  });

  it("by date, inclusive, and the ties a keyword matched", () => {
    expect(ids({ from: "2026-02-01", to: "2026-03-01" })).toEqual(["c", "b"]);
    expect(ids({ match_ids: ["a", "c"], from: "2026-02-01" })).toEqual(["c"]);
  });

  it("finds a keyword in titles, notes and plans' titles", () => {
    const index = searchIndex(ties, journal);
    expect(matchingTies(index, "futo")).toEqual(["a"]);
    expect(matchingTies(index, "HARNESS")).toEqual(["c"]);
    expect(matchingTies(index, "tk")).toEqual(["b"]);
  });

  it("refuses bad filters with the server's messages", () => {
    expect(() => filters({ from: "2026-03-01", to: "2026-01-01" })).toThrow("The start date is after the end date.");
    expect(() => filters({ page_size: 30 })).toThrow("Show 20, 50, 100 ties per page.");
    expect(() => filters({ page: 0 })).toThrow(/Page should/);
    expect(() => filters({ from: "yesterday" })).toThrow(/date like/);
  });
});

describe("paging and order", () => {
  // 25 ties: three on one day, logged at different times.
  const ties = Array.from({ length: 25 }, (_, i) => tie(`t${String(i).padStart(2, "0")}`, `2026-01-${String(i + 1).padStart(2, "0")}`));
  ties.push(tie("same-1", "2026-02-01", { created_at: "2026-02-01T10:00:00Z" }), tie("same-2", "2026-02-01", { created_at: "2026-02-01T11:00:00Z" }));
  const journal = journalOf(ties);

  it("gives 20 a page, newest first (same-day by when they were logged), with the totals", () => {
    const first = findTiesIn(ties, journal, filters({}));
    expect([first.ties.length, first.total, first.all_total, first.page, first.page_size]).toEqual([20, 27, 27, 1, 20]);
    expect(first.ties.slice(0, 3).map((t) => t.id)).toEqual(["same-2", "same-1", "t24"]);
    expect(findTiesIn(ties, journal, filters({ page: 2 })).ties.map((t) => t.id).at(-1)).toBe("t00");
  });

  it("sorts oldest first as exactly the reverse, and pages by 50", () => {
    const newest = findTiesIn(ties, journal, filters({ page_size: 50 })).ties.map((t) => t.id);
    expect(findTiesIn(ties, journal, filters({ page_size: 50, sort: "oldest" })).ties.map((t) => t.id)).toEqual([...newest].reverse());
  });
});

describe("recent pickers", () => {
  it("give the active ones most recently on a tie first, up to five", () => {
    const ties = [
      tie("a", "2026-01-01", { location_id: "studio", participants: [{ person_id: "sam", role: "bottom" }, { person_id: "old", role: "top" }] }),
      tie("b", "2026-03-01", { location_id: "home", participants: [{ person_id: "alex", role: "top" }], plans: [{ plan_id: "tk" }, { plan_id: null }] }),
    ];
    const journal = journalOf([...people, ...places, ...plans, ...ties]);
    expect(recentOn("locations", ties, journal)).toEqual(["home", "studio"]);
    expect(recentOn("people", ties, journal)).toEqual(["alex", "sam"]);
    expect(recentOn("plans", ties, journal)).toEqual(["tk"]);
    expect(recentOn("people", ties, journal, 1)).toEqual(["alex"]);
  });
});

describe("Analytics' ties", () => {
  const ties = [
    tie("b", "2026-02-01", { location_id: "studio", participants: [{ person_id: "me", role: "top" }, { person_id: "sam", role: "bottom" }], tags: ["box"] }),
    tie("a", "2026-01-01", { location_id: "home", participants: [{ person_id: "me", role: "bottom" }, { person_id: "alex", role: "top" }] }),
    tie("c", "2026-03-01", { location_deleted: true, participants: [{ person_id: null, role: "bottom" }] }),
  ];
  const journal = journalOf([...people, ...places, ...tags, ...ties]);
  /** @param {Record<string, any>} body */
  const ids = (body) => statsRows(ties, journal, body).map((t) => t.id);

  it("gives the ties oldest first, with only what the counting needs", () => {
    const [b] = statsRows(ties, journal, { from: "2026-02-01", to: "2026-02-28" });
    expect(b).toEqual({ id: "b", tie_date: "2026-02-01", tie_type: "floor", duration_minutes: null, success_rating: null,
      location_id: "studio", location_deleted: 0, location_name: "Studio", latitude: 51.5, longitude: -0.1,
      participants: [{ person_id: "me", person_name: "Me", is_self: true, role: "top" }, { person_id: "sam", person_name: "Sam", is_self: false, role: "bottom" }] });
    expect(ids({})).toEqual(["a", "b", "c"]);
  });

  it("filters by my role, and by any of the people, locations and tags", () => {
    expect(ids({ role: "top" })).toEqual(["b"]);
    expect(ids({ role: "bottom" })).toEqual(["a"]);
    expect(ids({ person_ids: ["sam", "alex"] })).toEqual(["a", "b"]);
    expect(ids({ person_ids: ["sam", "alex"], location_ids: ["home"] })).toEqual(["a"]);
    expect(ids({ tag_ids: ["box"] })).toEqual(["b"]);
    expect(() => ids({ role: "boss" })).toThrow(/Choose a role/);
  });

  it("shows a deleted person and location as such", () => {
    expect(statsRows(ties, journal, { from: "2026-03-01" })[0]).toMatchObject({
      location_id: null, location_deleted: 1, participants: [{ person_id: null, person_name: null, is_self: false, role: "bottom" }] });
  });
});
