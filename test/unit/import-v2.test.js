// Importing into a format 2 journal (records/import.js): format 1's
// import requests and answers, worked out on the device. The test the plan
// asks for: a journal's export imports back exactly, through the same
// steps the Your data view runs (import-steps.js), into an empty journal
// and into one that already has it (every tie and workshop a duplicate).
import { describe, it, expect } from "vitest";
import { importItems, importTies, importWorkshops } from "../../public/js/records/import.js";
import { journalExport } from "../../public/js/store/queries/export.js";
import { itemsBody, remapTies, remapWorkshops, batches } from "../../public/js/import-steps.js";
import { takePhotos } from "../../public/js/import-photos.js";
import { takeDrawings } from "../../public/js/import-drawings.js";
import { takePoses } from "../../public/js/import-poses.js";
import { duplicateMatches } from "../../public/js/import-dedupe.js";
import { recordProblems } from "../../public/js/records/schema.js";
import { RECORD_KINDS } from "../../public/js/crypto/records.js";

const NOW = "2026-11-14T12:00:00Z";
const T1 = "2026-01-01T00:00:00Z";

/** A journal in memory: records by id, and the import's save. */
function journal() {
  /** @type {Map<string, any>} */
  const records = new Map();
  let n = 0;
  return {
    records,
    newId: () => `id-${++n}`,
    mine: () => Object.fromEntries(RECORD_KINDS.map((k) => [k, [...records.values()].filter((r) => r.kind === k)])),
    /** @param {{ result: any, writes: any[] }} planned */
    save(planned) {
      for (const w of planned.writes) {
        expect(recordProblems(w.kind, w.body, { id: w.id }), `${w.kind} ${w.id}`).toEqual([]);
        records.set(w.id, { kind: w.kind, id: w.id, body: w.body });
      }
      return planned.result;
    },
  };
}

/**
 * Imports an export as the Your data view does (without its photos,
 * drawings and poses, which it saves afterwards through the visuals store).
 * @param {ReturnType<typeof journal>} into
 * @param {any} doc
 */
function runImport(into, doc) {
  const plain = takePoses(takeDrawings(takePhotos(doc).doc).doc).doc;
  const items = into.save(importItems(itemsBody(plain, false), into.mine(), into.newId, NOW));
  const tieIds = new Map();
  let added = 0;
  let skipped = 0;
  for (const [n, batch] of batches(remapTies(plain.ties, items)).entries()) {
    const preview = importTies({ preview: true, ties: batch }, into.mine(), into.newId, NOW).result;
    const matches = duplicateMatches(batches(plain.ties)[n], preview.candidates);
    const result = into.save(importTies({ ties: batch, skip: [...matches.keys()] }, into.mine(), into.newId, NOW));
    added += result.added;
    skipped += result.skipped;
    batch.forEach((/** @type {any} */ _, /** @type {number} */ i) => tieIds.set(String(plain.ties[n * 200 + i].id), result.ids[i] ?? matches.get(i)));
  }
  for (const [n, batch] of batches(remapWorkshops(plain.workshops, items, tieIds)).entries()) {
    const preview = importWorkshops({ preview: true, workshops: batch }, into.mine(), into.newId, NOW).result;
    const matches = duplicateMatches(batches(plain.workshops)[n], preview.candidates, ["description", "notes"]);
    const result = into.save(importWorkshops({ workshops: batch, skip: [...matches.keys()] }, into.mine(), into.newId, NOW));
    added += result.added;
    skipped += result.skipped;
  }
  return { added, skipped, items };
}

/**
 * An export with every id swapped for what it names, and the visuals and
 * export time left out, so two journals can be compared.
 * @param {any} doc
 */
function comparable(doc) {
  const names = new Map([
    ...doc.people.map((/** @type {any} */ p) => [p.id, `person:${p.name}`]),
    ...doc.locations.map((/** @type {any} */ l) => [l.id, `location:${l.name}`]),
    ...doc.plans.map((/** @type {any} */ p) => [p.id, `plan:${p.title}`]),
    ...doc.ties.map((/** @type {any} */ t) => [t.id, `tie:${t.tie_date}:${t.title}`]),
  ]);
  /** @param {any} id */
  const name = (id) => (id === null ? null : names.get(id) ?? `?${id}`);
  const strip = (/** @type {any} */ x) => {
    const { id: _id, photos: _p, drawings: _d, poses: _q, ...rest } = x;
    return rest;
  };
  return {
    people: doc.people.map(strip),
    locations: doc.locations.map(strip),
    plans: doc.plans.map((/** @type {any} */ p) => ({ ...strip(p), variation_of: name(p.variation_of) })),
    tags: doc.tags,
    ties: doc.ties.map((/** @type {any} */ t) => ({ ...strip(t), location_id: name(t.location_id),
      participants: t.participants.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) })),
      plans: t.plans.map((/** @type {any} */ p) => ({ ...p, plan_id: name(p.plan_id) })) })),
    workshops: doc.workshops.map((/** @type {any} */ w) => ({ ...strip(w), location_id: name(w.location_id),
      educators: w.educators.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) })),
      participants: w.participants.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) })),
      ties: w.ties.map(name), plans: w.plans.map(name) })),
  };
}

/** A journal with something of every kind, deleted links included. */
function seeded() {
  const j = journal();
  /** @param {string} kind @param {string} id @param {Record<string, any>} body */
  const put = (kind, id, body) => j.records.set(id, { kind, id, body: { created_at: T1, updated_at: T1, ...body } });
  put("person", "me", { name: "Me", is_self: true, default_role: "top", about: "Hello" });
  put("person", "sam", { name: "Sam", pronouns: "they", notes: "Likes futomomo", is_educator: true, aliases: [{ platform: "fetlife", alias: "sam" }],
    archived_at: T1, profile_notes: [{ id: "n1", type: "limit", description: "No neck", noted_on: "2026-01-02", is_current: true, created_at: T1, updated_at: T1 }] });
  put("location", "studio", { name: "Studio", city: "Leeds", latitude: 53.8, longitude: -1.5, is_default: true, maps_url: "https://maps.google.com/?q=53.8,-1.5" });
  put("tag", "box", { name: "box" });
  put("tag", "unused", { name: "Unused" });
  put("plan", "tk", { title: "TK", stage: "ready", plan_type: "harness", description: "Two ropes", est_difficulty: 3, version: 2, tags: ["box"], workshop_id: "w1" });
  put("plan", "tk2", { title: "TK 2", stage: "idea", plan_type: "idea", variation_of: "tk", version: 1 });
  put("tie", "t1", { title: "Session", tie_date: "2026-01-05", tie_type: "floor", notes: "Went well", duration_minutes: 60, success_rating: 4,
    location_id: "studio", tags: ["box"], workshop_id: "w1",
    participants: [{ person_id: "sam", role: "bottom", difficulty_rating: 3 }, { person_id: null, role: "spotter" }, { person_id: "me", role: "top" }],
    plans: [{ plan_id: "tk", plan_version: 1 }, { plan_id: null, plan_version: 3 }] });
  put("tie", "t2", { tie_date: "2026-02-01", tie_type: "suspension", location_deleted: true });
  put("workshop", "w1", { title: "Intro", start_date: "2026-01-04", end_date: "2026-01-05", attendee_count: 8, rating: 5, cost: "USD 10.00",
    description: "Basics", people: [{ person_id: "sam", kind: "educator", role: "top" }, { person_id: "me", kind: "participant", role: "audit" }] });
  return j;
}

/** @param {ReturnType<typeof journal>} j */
const exportOf = (j) => journalExport(/** @type {any} */ (j.mine()));

describe("importing a format 2 export into a format 2 journal", () => {
  it("brings it back exactly into an empty journal", () => {
    const from = exportOf(seeded());
    const into = journal();
    const { added, skipped } = runImport(into, from);
    expect([added, skipped]).toEqual([3, 0]);
    expect(comparable(exportOf(into))).toEqual(comparable(from));
  });

  it("adds nothing again into the same journal: everything matches or is a duplicate", () => {
    const j = seeded();
    const before = exportOf(j);
    const count = j.records.size;
    const { added, skipped, items } = runImport(j, before);
    expect([added, skipped, j.records.size]).toEqual([0, 3, count]);
    expect(items.people.every((/** @type {any} */ p) => p.matched)).toBe(true);
    expect(comparable(exportOf(j))).toEqual(comparable(before));
  });
});

describe("the items request", () => {
  it("matches by name (me whatever its name), makes the rest, takes the default only without one, and previews without saving", () => {
    const j = seeded();
    const body = {
      preview: true,
      people: [{ id: "a", name: "SAM" }, { id: "b", name: "Me again", is_self: true }, { id: "c", name: "Sam", match: false }, { id: "d", name: "Kit", connection_id: "x" }],
      locations: [{ id: "l", name: "Home", is_default: true }],
      plans: [{ id: "p", title: "tk" }],
      tags: ["BOX", "new"],
    };
    const { result, writes } = importItems(body, j.mine(), j.newId, NOW);
    expect(result.people.map((/** @type {any} */ p) => [p.id, p.matched])).toEqual([["sam", true], ["me", true], [null, false], [null, false]]);
    expect([result.plans[0].id, result.new_tags, result.links_dropped, writes]).toEqual(["tk", ["new"], 1, []]);
    const saved = importItems({ ...body, preview: false }, j.mine(), j.newId, NOW).writes;
    expect(saved.find((w) => w.kind === "location")?.body.is_default).toBe(false);
  });

  it("refuses what the server refused, naming the item", () => {
    const j = journal();
    expect(() => importItems({ people: [{ id: "a", name: "A", is_self: true }, { id: "b", name: "B", is_self: true }] }, j.mine(), j.newId, NOW))
      .toThrow("Only one person can be marked as you.");
    expect(() => importItems({ plans: [{ id: "p", title: "P", variation_of: "q" }] }, j.mine(), j.newId, NOW)).toThrow(/isn't in the file/);
    expect(() => importItems({ people: [{ id: "a", name: "A", about_shared_on: "soon" }] }, j.mine(), j.newId, NOW)).toThrow(/People 1 \("A"\): Expected a date/);
    expect(() => importItems({ locations: [{ id: "l", name: "L" }, { id: "l", name: "M" }] }, j.mine(), j.newId, NOW)).toThrow(/used twice/);
  });
});

describe("the ties request", () => {
  it("links only to what's mine, needs a date and type, and keeps a plan's version or takes the plan's", () => {
    const j = seeded();
    const tie = { tie_date: "2026-03-01", tie_type: "floor" };
    expect(() => importTies({ ties: [{ ...tie, location_id: "nope" }] }, j.mine(), j.newId, NOW)).toThrow(/Tie 1: Linked item not found/);
    expect(() => importTies({ ties: [{ tie_type: "floor" }] }, j.mine(), j.newId, NOW)).toThrow(/Add a date/);
    const { writes } = importTies({ ties: [{ ...tie, plans: [{ plan_id: "tk" }], tags: ["Box", "Fresh"] }] }, j.mine(), j.newId, NOW);
    expect(writes.map((w) => w.kind)).toEqual(["tag", "tie"]);
    expect(writes[1].body).toMatchObject({ plans: [{ plan_id: "tk", plan_version: 2 }], tags: ["box", writes[0].id] });
  });
});

describe("previews (found by the walkthrough on format 2)", () => {
  it("check a batch's links only when saving, as format 1's preview did: a preview links to people the items' preview made up", () => {
    const j = journal();
    const ties = [{ tie_date: "2026-03-01", tie_type: "floor", location_id: "not-saved-yet", participants: [{ person_id: "nor-this", role: "top" }] }];
    expect(() => importTies({ preview: true, ties }, j.mine(), j.newId, NOW)).not.toThrow();
    expect(() => importTies({ ties }, j.mine(), j.newId, NOW)).toThrow(/Linked item not found/);
  });

  it("say which of a batch's tags are new", () => {
    const j = seeded();
    const { result } = importTies({ preview: true, ties: [{ tie_date: "2026-03-01", tie_type: "floor", tags: ["BOX", "imported"] }] },
      j.mine(), j.newId, NOW);
    expect(result.new_tags).toEqual(["imported"]);
  });
});
