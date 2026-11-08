import { describe, it, expect } from "vitest";
import { call, create, createOtherUser, sessionCookieFor, signedInUser, sql, sealed } from "../helpers.js";
import { duplicatePositions, duplicateMatches } from "../../public/js/import-dedupe.js";
import { convertJournal } from "../../public/js/journal-fields.js";
import { ENCRYPTED } from "../../public/js/crypto/fields.js";
import { readExport, itemsBody, remapTies, remapWorkshops, batches, TIE_BATCH } from "../../public/js/import-steps.js";
import { parseCsv } from "../../public/js/csv.js";
import { csvToImport } from "../../public/js/import-csv.js";
import { takeDrawings } from "../../public/js/import-drawings.js";
import { takePoses } from "../../public/js/import-poses.js";
import { presetsToAdd } from "../../public/js/import-presets.js";
import { MAX_PRESETS } from "../../src/pose-presets/parse.js";
import { shareToImport, withKnown, addsItems } from "../../public/js/share-to-import.js";
import { buildItemShare, itemSource, readItemShare, FIELDS } from "../../public/js/share-item.js";
import template from "../../public/import-template.csv?raw";

/** A new user, signed in. */
async function newUser() {
  const id = await createOtherUser();
  return { id, cookie: await sessionCookieFor(id) };
}

/**
 * Seals a file's notes as the page does, here with the test's stand-in
 * (sealed() of the text), so equal notes seal equal and "opening" a
 * candidate's notes is just comparing.
 * @param {any} doc
 */
function sealFile(doc) {
  return convertJournal(doc, async (kind, records) => records.map((r) => {
    const out = { ...r };
    for (const f of ENCRYPTED[kind].fields) if (typeof r[f] === "string" && !r[f].startsWith("e1.")) out[f] = sealed(r[f].trim());
    return out;
  }));
}

/**
 * Imports a file the way the page does: items, then ties in batches, each
 * checked for duplicates first (candidates from the server, notes compared
 * here), sending which to skip; then workshops the same way; then the
 * drawings and poses of the ties, plans and workshops just added (the
 * file's captions are already sealed here, as the export left them); then
 * the saved poser presets not already there by name (the stand-in seals
 * equal names equally, so sealed names compare as the page's opened ones).
 * @param {any} file
 * @param {string} cookie
 * @param {number} [batchSize]
 */
async function importFile(file, cookie, batchSize) {
  const drawings = takeDrawings(readExport(file));
  const poses = takePoses(drawings.doc);
  const doc = await sealFile(poses.doc);
  const items = await call("/api/data/import/items", { method: "POST", body: itemsBody(doc, false), cookie });
  expect(items.status, JSON.stringify(items.body)).toBe(200);
  /** Where each drawing and pose goes: [path, item, entries]. @type {[string, Record<string, string>, { data: any, caption: string | null }[]][]} */
  const drawingTargets = [];
  /**
   * @param {Record<string, string>} item
   * @param {(lists: typeof drawings | typeof poses) => { data: any, caption: string | null }[] | undefined} entriesOf
   */
  const target = (item, entriesOf) => {
    const drawn = entriesOf(drawings);
    if (drawn) drawingTargets.push(["/api/drawings", item, drawn]);
    const posed = entriesOf(poses);
    if (posed) drawingTargets.push(["/api/poses", item, posed]);
  };
  for (const plan of items.body.plans) {
    if (!plan.matched) target({ plan_id: plan.id }, (lists) => lists.plans.get(String(plan.file_id)));
  }
  let added = 0;
  let skipped = 0;
  // The file's tie ids to mine, for the workshops' linked ties, as the page does.
  /** @type {Map<string, string>} */
  const tieIds = new Map();
  for (const [n, ties] of batches(remapTies(doc.ties, items.body), batchSize).entries()) {
    const preview = await call("/api/data/import/ties", { method: "POST", body: { preview: true, ties }, cookie });
    const skip = duplicatePositions(ties, preview.body.candidates);
    const res = await call("/api/data/import/ties", { method: "POST", body: { ties, skip }, cookie });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    added += res.body.added;
    skipped += res.body.skipped;
    const matched = new Map((preview.body.candidates ?? []).map((/** @type {any} */ c) => [c.i, c.id]));
    res.body.ids.forEach((/** @type {string | null} */ id, /** @type {number} */ i) => {
      const at = n * (batchSize ?? TIE_BATCH) + i;
      const mine = id ?? matched.get(i);
      if (mine) tieIds.set(String(doc.ties[at].id), mine);
      if (id) target({ tie_id: id }, (lists) => lists.ties.get(at));
    });
  }
  let workshopsAdded = 0;
  let workshopsSkipped = 0;
  for (const [n, workshops] of batches(remapWorkshops(doc.workshops, items.body, tieIds), batchSize).entries()) {
    const preview = await call("/api/data/import/workshops", { method: "POST", body: { preview: true, workshops }, cookie });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const skip = [...duplicateMatches(workshops, preview.body.candidates, ["description", "notes"]).keys()];
    const res = await call("/api/data/import/workshops", { method: "POST", body: { workshops, skip }, cookie });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    workshopsAdded += res.body.added;
    workshopsSkipped += res.body.skipped;
    res.body.ids.forEach((/** @type {string | null} */ id, /** @type {number} */ i) => {
      if (id) target({ workshop_id: id }, (lists) => lists.workshops.get(n * (batchSize ?? TIE_BATCH) + i));
    });
  }
  for (const [path, item, entries] of drawingTargets) {
    for (const { data, caption } of entries) {
      const res = await call(path, { method: "POST", body: { ...item, data, caption }, cookie });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
  }
  const mine = (await call("/api/pose-presets", { cookie })).body;
  for (const preset of presetsToAdd(file.account?.pose_presets, mine, MAX_PRESETS - mine.length).add) {
    const res = await call("/api/pose-presets", { method: "POST", body: preset, cookie });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
  return { items: items.body, added, skipped, workshopsAdded, workshopsSkipped };
}

/** @param {string} cookie */
async function exportOf(cookie) {
  return (await call("/api/data/export", { cookie })).body;
}

/**
 * An export with ids swapped for names, so two journals' exports compare.
 * @param {any} doc
 */
function comparable(doc) {
  const names = new Map([
    ...doc.ties.map((/** @type {any} */ t) => [t.id, `tie:${t.title}`]),
    ...doc.people.map((/** @type {any} */ p) => [p.id, `person:${p.name}`]),
    ...doc.locations.map((/** @type {any} */ l) => [l.id, `location:${l.name}`]),
    ...doc.plans.map((/** @type {any} */ p) => [p.id, `plan:${p.title}`]),
  ]);
  const name = (/** @type {string | null} */ id) => (id === null ? null : names.get(id));
  const byText = (/** @type {any[]} */ list) => list.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // A drawing or pose gets a new id, and is new (created_at, updated_at), in the copy.
  const drawings = (/** @type {any[]} */ list) => list.map(({ data, caption, position }) => ({ data, caption, position }));
  return {
    // A preset is new (created_at, updated_at) in the copy too.
    pose_presets: doc.account.pose_presets.map(({ kind, name, data }) => ({ kind, name, data })),
    people: byText(doc.people.map(({ id: _id, ...p }) => p)),
    locations: byText(doc.locations.map(({ id: _id, ...l }) => l)),
    plans: byText(doc.plans.map(({ id: _id, ...p }) => ({
      ...p, variation_of: name(p.variation_of), drawings: drawings(p.drawings), poses: drawings(p.poses),
    }))),
    tags: doc.tags,
    ties: byText(doc.ties.map(({ id: _id, ...t }) => ({
      ...t,
      location_id: name(t.location_id),
      participants: byText(t.participants.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) }))),
      plans: byText(t.plans.map((/** @type {any} */ p) => ({ ...p, plan_id: name(p.plan_id) }))),
      drawings: drawings(t.drawings),
      poses: drawings(t.poses),
    }))),
    workshops: byText(doc.workshops.map(({ id: _id, ...w }) => ({
      ...w,
      location_id: name(w.location_id),
      educators: byText(w.educators.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) }))),
      participants: byText(w.participants.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) }))),
      ties: w.ties.map(name).sort(),
      plans: w.plans.map(name).sort(),
      drawings: drawings(w.drawings),
      poses: drawings(w.poses),
    }))),
  };
}

/** Fills the signed-in test user's journal with linked, archived and deleted things. */
async function fillJournal() {
  const me = await create("/api/people", { name: "Me", is_self: true });
  const sam = await create("/api/people", {
    name: "Sam", pronouns: "they/them", notes: sealed("Floor work"), default_role: "bottom",
    is_educator: true, based_in: sealed("Seattle, WA"), aliases: sealed('[{"platform":"scene","alias":"sammy"}]'),
    about: sealed("Teaches on weekends"), about_shared_on: "2026-10-24",
  });
  const gone = await create("/api/people", { name: "Gone" });
  await call(`/api/people/${sam}/archive`, { method: "POST" });
  await sql("INSERT INTO profile_notes (id, person_id, type, description, noted_on) VALUES (?, ?, 'injury', ?, '2026-01-02')",
    crypto.randomUUID(), sam, sealed("Left shoulder")).run();
  const studio = await create("/api/locations", {
    name: "Studio", notes: sealed("Beam"), city: "Seattle", state_province: "WA", country: "USA", latitude: 51.5, longitude: -0.12, is_default: true });
  const old = await create("/api/locations", { name: "Old flat" });
  const tk = await create("/api/plans", { title: "TK", stage: "ready", plan_type: "harness", est_difficulty: 3 });
  const tk2 = await create("/api/plans", {
    title: "TK 2", variation_of: tk, tie_type: "floor", album_url: sealed("https://photos.app.goo.gl/tk2"), tags: ["kata", "floor"],
  });
  const dropped = await create("/api/plans", { title: "Dropped" });
  await call(`/api/plans/${tk}`, { method: "PUT", body: { title: "TK", plan_type: "harness", est_difficulty: 3 } });
  await sql("UPDATE plans SET version = 4 WHERE id = ?", tk).run();
  const floor = await create("/api/ties", {
    title: "Floor", tie_date: "2026-10-01", tie_type: "partial suspension", notes: sealed("Went well"), success_rating: 4, duration_minutes: 50, location_id: studio,
    album_url: sealed("https://photos.app.goo.gl/floor"),
    participants: [{ person_id: me, role: "top" }, { person_id: sam, role: "bottom" }, { person_id: gone, role: "spotter" }],
    plan_ids: [tk, tk2, dropped], tags: ["floor", "Futomomo"],
  });
  await create("/api/ties", { title: "At the old flat", tie_type: "floor", tie_date: "2026-09-01", location_id: old });
  await create("/api/ties", { tie_type: "floor", tie_date: "2026-01-01", title: "No date" });
  for (let i = 0; i < 5; i++) await create("/api/ties", { title: `Practice ${i}`, tie_type: "floor", tie_date: `2026-08-0${i + 1}` });
  const intensive = await create("/api/workshops", {
    title: "Intensive", start_date: "2026-04-01", end_date: "2026-04-03", location_id: studio, attendee_count: 14, rating: 5,
    difficulty: 4, rating_content: 5, rating_teaching: 3, rating_value: 4, cost: sealed("EUR 250.00"), event_url: sealed("https://example.com/intensive"),
    description: sealed("Uplines"), notes: sealed("Practise the TK"), album_url: sealed("https://photos.app.goo.gl/ws"),
    educators: [{ person_id: sam, role: "top" }, { person_id: gone, role: "audit" }],
    participants: [{ person_id: me, role: "top" }], tags: ["suspension", "floor"],
  });
  await create("/api/workshops", {
    title: "Teaching floor", start_date: "2026-05-01", location_id: old, educators: [{ person_id: me, role: "top" }],
  });
  // A tie at the intensive, and a plan learned there.
  await call(`/api/workshops/${intensive}/links`, { method: "POST", body: { tie_id: floor } });
  await call(`/api/workshops/${intensive}/links`, { method: "POST", body: { plan_id: tk2 } });
  // Drawings on a tie (two, in order), a plan and a workshop.
  const lines = (/** @type {string} */ c) => ({ v: 1, strokes: [{ c, w: 2, p: [10, 20, 30, 40] }, { c: "black", w: 3, p: [5, 5] }] });
  await create("/api/drawings", { tie_id: floor, data: lines("red"), caption: sealed("Front") });
  await create("/api/drawings", { tie_id: floor, data: lines("blue"), caption: null });
  await create("/api/drawings", { plan_id: tk2, data: lines("green"), caption: sealed("Harness") });
  await create("/api/drawings", { workshop_id: intensive, data: lines("pink"), caption: null });
  // Poses on a tie (two, in order), a plan and a workshop.
  const posed = (/** @type {number} */ knee) => ({
    v: 1, joints: { l_knee: [knee] }, body: [90, 0, 0], lift: 110, camera: [20, 10, 300, 110], ring: [0, 280, 0],
    ropes: [{ c: "red", w: 2, p: [["chest", 0, 120, 110], ["ring", 0, 0, 0]] }],
  });
  await create("/api/poses", { tie_id: floor, data: posed(10), caption: sealed("Step 1") });
  await create("/api/poses", { tie_id: floor, data: posed(90), caption: null });
  await create("/api/poses", { plan_id: tk2, data: posed(45), caption: sealed("Sequence") });
  await create("/api/poses", { workshop_id: intensive, data: posed(120), caption: null });
  // Saved poser presets, a body one and an arms one.
  await create("/api/pose-presets", { kind: "body", name: sealed("Seiza"), data: { joints: { l_knee: [155], r_knee: [155] }, body: [0, 0, 0], lift: 29 } });
  await create("/api/pose-presets", { kind: "arms", name: sealed("Boxtie"), data: { joints: { l_elbow: [105], r_elbow: [90] } } });
  await call(`/api/people/${gone}`, { method: "DELETE" });
  await call(`/api/locations/${old}`, { method: "DELETE" });
  await call(`/api/plans/${dropped}?linked_ties=keep`, { method: "DELETE" });
  await sql("INSERT INTO tags (id, owner_id, name) VALUES (?, ?, 'unused')", crypto.randomUUID(), (await signedInUser()).id).run();
}

describe("importing an export", () => {
  it("rebuilds the same journal in another account, and adds nothing the second time", async () => {
    await fillJournal();
    const original = await exportOf((await signedInUser()).cookie);
    const other = await newUser();

    // Small batches, to cover a file sent in several.
    const first = await importFile(original, other.cookie, 3);
    expect([first.added, first.skipped, first.workshopsAdded, first.workshopsSkipped]).toEqual([8, 0, 2, 0]);
    const copy = await exportOf(other.cookie);
    expect(comparable(copy)).toEqual(comparable(original));
    // Fresh ids: nothing in the copy shares an id with the original.
    expect(copy.ties.map((/** @type {any} */ t) => t.id)).not.toContain(original.ties[0].id);

    const again = await importFile(original, other.cookie);
    expect([again.added, again.skipped, again.workshopsAdded, again.workshopsSkipped]).toEqual([0, 8, 0, 2]);
    expect(again.items.people.every((/** @type {any} */ p) => p.matched)).toBe(true);
    expect(comparable(await exportOf(other.cookie))).toEqual(comparable(original));
  });

  it("previews without saving anything", async () => {
    const user = await newUser();
    await call("/api/people", { method: "POST", body: { name: "sam" }, cookie: user.cookie });
    await call("/api/ties", { method: "POST", body: { title: "Floor", tie_type: "floor", tie_date: "2026-10-01" }, cookie: user.cookie });

    const items = await call("/api/data/import/items", { method: "POST", cookie: user.cookie, body: {
      preview: true, people: [{ id: "a", name: "Sam" }, { id: "b", name: "Alex" }], tags: ["new tag"],
    } });
    expect(items.body).toEqual({
      people: [
        { file_id: "a", name: "Sam", id: expect.any(String), matched: true },
        { file_id: "b", name: "Alex", id: null, matched: false },
      ],
      locations: [], plans: [], new_tags: ["new tag"], links_dropped: 0,
    });
    const ties = await call("/api/data/import/ties", { method: "POST", cookie: user.cookie, body: {
      preview: true, ties: [{ title: "New", tie_type: "floor", tie_date: "2026-10-02" }, { title: "Floor", tie_type: "floor", tie_date: "2026-10-01" }, { title: "x", tie_type: "floor", tie_date: "2026-10-03", tags: ["t"] }],
    } });
    // The candidates: my ties the same in all but the notes (encrypted, so
    // the page compares those), with their ids (for a skipped tie's photos).
    const floor = await sql("SELECT id FROM ties WHERE owner_id = ? AND title = 'Floor'", user.id).first();
    expect(ties.body).toEqual({ candidates: [{ i: 1, id: floor?.id, notes: null }], new_tags: ["t"] });

    expect(await sql("SELECT count(*) AS n FROM people WHERE owner_id = ?", user.id).first()).toEqual({ n: 1 });
    expect(await sql("SELECT count(*) AS n FROM ties WHERE owner_id = ?", user.id).first()).toEqual({ n: 1 });
    expect(await sql("SELECT count(*) AS n FROM tags WHERE owner_id = ?", user.id).first()).toEqual({ n: 0 });
  });

  it("finds candidates the same in everything but the notes, and leaves out the ties it's told to skip", async () => {
    const user = await newUser();
    /** @param {string} path @param {Record<string, unknown>} body */
    const add = async (path, body) => (await call(path, { method: "POST", body, cookie: user.cookie })).body.id;
    const sam = await add("/api/people", { name: "Sam" });
    const alex = await add("/api/people", { name: "Alex" });
    const studio = await add("/api/locations", { name: "Studio" });
    const plan = await add("/api/plans", { title: "TK" });
    const saved = {
      tie_date: "2026-10-01", title: null, notes: null, tie_type: "floor", location_id: studio,
      duration_minutes: 30, success_rating: 4,
      participants: [{ person_id: sam, role: "bottom" }, { person_id: alex, role: "top" }],
      plan_ids: [plan], tags: ["Floor", "kata"],
    };
    // Two untitled ties on the same day with no notes, told apart by their people.
    await add("/api/ties", saved);
    await add("/api/ties", { ...saved, participants: [{ person_id: sam, role: "bottom" }] });

    // As the export writes it: plans as objects, tags in any order and capitals.
    const same = {
      ...saved, plan_ids: undefined, plans: [{ plan_id: plan, plan_version: 1 }],
      participants: [...saved.participants].reverse(), tags: ["KATA", "floor"],
    };
    /** @type {Record<string, any>[]} */
    const variants = [
      same,
      { ...same, participants: [{ person_id: alex, role: "bottom" }] },
      { ...same, tags: ["floor"] },
      { ...same, tags: [...same.tags, "brand new"] },
      { ...same, plans: [] },
      { ...same, tie_type: "suspension" },
      { ...same, location_id: null },
      { ...same, duration_minutes: 31 },
      { ...same, success_rating: null },
      { ...same, tie_date: "2026-10-02" },
      { ...same, participants: [{ person_id: sam, role: "bottom" }] },
    ];
    // Notes don't make a tie a candidate or not: the page compares them.
    variants.push({ ...same, notes: sealed("different notes") });
    const preview = await call("/api/data/import/ties", { method: "POST", cookie: user.cookie, body: { preview: true, ties: variants } });
    expect(preview.body.candidates.map((/** @type {any} */ c) => c.i).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b)).toEqual([0, 10, 11]);
    expect(duplicatePositions(variants, preview.body.candidates)).toEqual([0, 10]);
    const res = await call("/api/data/import/ties", { method: "POST", cookie: user.cookie, body: { ties: variants, skip: [0, 10] } });
    expect(res.body).toMatchObject({ added: 10, skipped: 2 });
    // Each tie's new id by position (null for the skipped ones), and those are the ties saved.
    expect(res.body.ids).toHaveLength(12);
    expect([res.body.ids[0], res.body.ids[10]]).toEqual([null, null]);
    const newIds = res.body.ids.filter(Boolean);
    expect(new Set(newIds).size).toBe(10);
    for (const id of newIds) expect(await sql("SELECT 1 AS ok FROM ties WHERE id = ? AND owner_id = ?", id, user.id).first()).toEqual({ ok: 1 });
    const bad = await call("/api/data/import/ties", { method: "POST", cookie: user.cookie, body: { ties: variants, skip: [99] } });
    expect(bad.status).toBe(400);
  });

  it("finds workshop candidates the same in everything but what's encrypted", async () => {
    const user = await newUser();
    /** @param {string} path @param {Record<string, unknown>} body */
    const add = async (path, body) => (await call(path, { method: "POST", body, cookie: user.cookie })).body.id;
    const kit = await add("/api/people", { name: "Kit" });
    const studio = await add("/api/locations", { name: "Studio" });
    const saved = {
      title: "Intro", start_date: "2026-03-01", end_date: null, location_id: studio, attendee_count: 10, rating: 4,
      description: sealed("Basics"), notes: null, tags: ["Floor"],
    };
    const id = await add("/api/workshops", { ...saved, educators: [{ person_id: kit, role: "top" }] });
    const same = { ...saved, educators: [{ person_id: kit, role: "top" }], tags: ["floor"] };
    /** @type {Record<string, any>[]} */
    const variants = [
      same,
      { ...same, educators: [], participants: [{ person_id: kit, role: "top" }] },
      { ...same, educators: [{ person_id: kit, role: "bottom" }] },
      { ...same, title: "Intro 2" },
      { ...same, end_date: "2026-03-02" },
      { ...same, attendee_count: null },
      { ...same, tags: [] },
      // Encrypted fields don't make it a candidate or not: the page compares them.
      { ...same, description: sealed("Other") },
    ];
    const preview = await call("/api/data/import/workshops", { method: "POST", cookie: user.cookie, body: { preview: true, workshops: variants } });
    expect(preview.body.candidates).toEqual([
      { i: 0, id, description: sealed("Basics"), notes: null },
      { i: 7, id, description: sealed("Basics"), notes: null },
    ]);
    expect([...duplicateMatches(variants, preview.body.candidates, ["description", "notes"]).keys()]).toEqual([0]);
    const res = await call("/api/data/import/workshops", { method: "POST", cookie: user.cookie, body: { workshops: variants, skip: [0] } });
    expect(res.body).toMatchObject({ added: 7, skipped: 1 });
    expect(res.body.ids[0]).toBeNull();
    // Someone listed twice (a file edited by hand) is kept once.
    const twice = await call("/api/data/import/workshops", { method: "POST", cookie: user.cookie, body: {
      workshops: [{ title: "Twice", start_date: "2026-01-01", educators: [{ person_id: kit, role: "top" }], participants: [{ person_id: kit, role: "bottom" }] }],
    } });
    expect(twice.status).toBe(200);
    expect(await sql("SELECT kind FROM workshop_people WHERE workshop_id = ?", twice.body.ids[0]).all())
      .toMatchObject({ results: [{ kind: "educator" }] });
    for (const workshops of [[{ start_date: "2026-01-01" }], [{ title: "x" }], [{ title: "x", start_date: "2026-01-01", notes: "plain" }], "x"]) {
      const bad = await call("/api/data/import/workshops", { method: "POST", cookie: user.cookie, body: { workshops } });
      expect(bad.status, JSON.stringify(workshops)).toBe(400);
    }
  });

  it("imports the CSV template, matching names to the journal's", async () => {
    const user = await newUser();
    const post = async (/** @type {string} */ path, /** @type {any} */ body) =>
      (await call(path, { method: "POST", body, cookie: user.cookie })).body.id;
    const sam = await post("/api/people", { name: "sam" });
    const plan = await post("/api/plans", { title: "Hip harness" });
    await sql("UPDATE plans SET version = 2 WHERE id = ?", plan).run();

    const { doc, errors } = csvToImport(parseCsv(template));
    expect(errors).toEqual([]);
    const result = await importFile({ format: "notonawa-export", version: 1, ...doc }, user.cookie);
    expect([result.added, result.skipped]).toEqual([1, 0]);
    expect(result.items.people.map((/** @type {any} */ p) => [p.name, p.matched])).toEqual([["Sam", true], ["Alex", false]]);

    const [tie] = (await call("/api/ties/search", { method: "POST", body: {}, cookie: user.cookie })).body.ties;
    expect(tie).toMatchObject({
      title: "Floor practice", tie_date: "2026-10-12", tie_type: "floor", duration_minutes: 45, success_rating: 4,
      location_name: "Studio", notes: sealed("Went well. Notes can have commas, in quotes."),
      album_url: sealed("https://photos.app.goo.gl/example"),
      plans: [{ plan_id: plan, plan_title: "Hip harness", plan_version: 2 }],
    });
    expect(tie.participants).toEqual(expect.arrayContaining([
      { id: expect.any(String), person_id: sam, person_name: "sam", role: "bottom" },
      expect.objectContaining({ person_name: "Alex", role: "top" }),
    ]));
    const tags = (await call("/api/tags", { cookie: user.cookie })).body.map((/** @type {any} */ t) => t.name).sort();
    expect(tags).toEqual(["floor", "practice"]);
  });

  it("uses each plan's current version when the file doesn't say", async () => {
    const user = await newUser();
    const items = await importFile({
      format: "notonawa-export", version: 1,
      plans: [{ id: "p", title: "TK", version: 3 }],
      ties: [{ title: "Tie", tie_type: "floor", tie_date: "2026-01-01", plans: [{ plan_id: "p" }] }],
    }, user.cookie);
    expect(await sql("SELECT plan_version FROM tie_plans WHERE plan_id = ?", items.items.plans[0].id).first())
      .toEqual({ plan_version: 3 });
  });

  it("keeps a new person's link only to a connection of mine on no one else, saying how many it dropped", async () => {
    const user = await newUser();
    /** Both sides of a connection between two accounts; returns the first's. */
    const connect = async (/** @type {string} */ owner, /** @type {string} */ peer) => {
      const id = crypto.randomUUID();
      await sql("INSERT INTO connections (id, owner_id, peer_id, invited) VALUES (?, ?, ?, 0), (?, ?, ?, 1)",
        id, owner, peer, crypto.randomUUID(), peer, owner).run();
      return id;
    };
    const mine = await connect(user.id, await createOtherUser());
    const taken = await connect(user.id, await createOtherUser());
    await sql("INSERT INTO people (id, owner_id, name, connection_id) VALUES (?, ?, 'Linked', ?)", crypto.randomUUID(), user.id, taken).run();
    const stranger = await createOtherUser();
    const theirs = await connect(stranger, await createOtherUser());
    const people = [
      // Restoring a deleted card: its connection is still mine.
      { id: "a", name: "Sam", connection_id: mine },
      // The same connection twice: only the first keeps it.
      { id: "b", name: "Sam again", connection_id: mine },
      { id: "c", name: "Rin", connection_id: theirs },
      { id: "d", name: "Kit", connection_id: "made-up" },
      { id: "e", name: "Lee", connection_id: taken },
    ];
    const preview = await call("/api/data/import/items", { method: "POST", cookie: user.cookie, body: { preview: true, people } });
    expect(preview.body.links_dropped).toBe(4);
    const res = await call("/api/data/import/items", { method: "POST", cookie: user.cookie, body: { people } });
    expect(res.body.links_dropped).toBe(4);
    const links = await sql("SELECT name, connection_id FROM people WHERE owner_id = ? ORDER BY name", user.id).all();
    expect(links.results).toEqual([
      { name: "Kit", connection_id: null }, { name: "Lee", connection_id: null }, { name: "Linked", connection_id: taken },
      { name: "Rin", connection_id: null }, { name: "Sam", connection_id: mine }, { name: "Sam again", connection_id: null },
    ]);
  });

  it("adds people, locations and plans sent with match: false, even when the name is one of mine", async () => {
    const user = await newUser();
    const post = async (/** @type {string} */ path, /** @type {any} */ body) =>
      (await call(path, { method: "POST", body, cookie: user.cookie })).body.id;
    const sam = await post("/api/people", { name: "Sam" });
    await post("/api/locations", { name: "Studio" });
    await post("/api/plans", { title: "TK" });
    const body = {
      people: [{ id: "a", name: "Sam", match: false }, { id: "b", name: "Sam" }],
      locations: [{ id: "l", name: "Studio", match: false }],
      plans: [{ id: "p", title: "TK", match: false }],
    };
    const preview = await call("/api/data/import/items", { method: "POST", cookie: user.cookie, body: { ...body, preview: true } });
    expect(preview.body.people.map((/** @type {any} */ p) => [p.matched, p.id])).toEqual([[false, null], [true, sam]]);
    const res = await call("/api/data/import/items", { method: "POST", cookie: user.cookie, body });
    expect([res.body.locations[0].matched, res.body.plans[0].matched]).toEqual([false, false]);
    const count = async (/** @type {string} */ table) =>
      (await sql(`SELECT COUNT(*) AS n FROM ${table} WHERE owner_id = ?`, user.id).first())?.n;
    // Two of each: mine, and the one sent with match: false.
    expect([await count("people"), await count("locations"), await count("plans")]).toEqual([2, 2, 2]);
  });

  it("adds a shared tie as the recipient chose: Me, one of their people, and a new person with a name they have", async () => {
    const user = await newUser();
    const post = async (/** @type {string} */ path, /** @type {any} */ body) =>
      (await call(path, { method: "POST", body, cookie: user.cookie })).body.id;
    const me = await post("/api/people", { name: "Me", is_self: true });
    const jude = await post("/api/people", { name: "Jude" });
    const studio = await post("/api/locations", { name: "Studio" });
    // As the sender's page builds it, and the recipient's reads it.
    const snapshot = buildItemShare("tie", itemSource("tie", {
      title: "Floor session", tie_date: "2026-10-12", tie_type: "floor", notes: "Smooth", tags: ["Futomomo"],
      participants: [{ person_id: "s", person_name: "Me", role: "top" }, { person_id: "x", person_name: "Sam", role: "bottom" },
        { person_id: "y", person_name: "Jude", role: "spotter" }],
      plans: [{ plan_id: "p", plan_title: "Hip harness" }],
    }, { selfId: "s", myName: "Jude", location: { name: "Studio" }, visuals: [] }), FIELDS.tie.map((f) => f.key));
    const item = /** @type {any} */ (readItemShare("tie", JSON.parse(JSON.stringify(snapshot))));
    const { doc, known } = shareToImport("tie", item, {
      people: [{ type: "person", id: jude }, { type: "me" }, { type: "new", name: "Jude" }],
      location: { type: "existing", id: studio }, plans: [{ type: "new", name: "Hip harness" }],
    }, me);
    expect(addsItems(doc)).toBe(true);
    const sealedDoc = await sealFile(doc);
    const items = (await call("/api/data/import/items", { method: "POST", cookie: user.cookie, body: itemsBody(sealedDoc, false) })).body;
    const res = await call("/api/data/import/ties", {
      method: "POST", cookie: user.cookie, body: { ties: remapTies(sealedDoc.ties, withKnown(items, known)), skip: [] },
    });
    expect(res.body.added).toBe(1);

    const [tie] = (await call("/api/ties/search", { method: "POST", body: {}, cookie: user.cookie })).body.ties;
    const newJude = items.people[0].id;
    expect(newJude).not.toBe(jude);
    expect(tie).toMatchObject({ title: "Floor session", location_id: studio, notes: sealed("Smooth"), tags: ["Futomomo"],
      plans: [{ plan_title: "Hip harness" }] });
    expect(tie.participants.map((/** @type {any} */ p) => [p.person_id, p.role]).sort()).toEqual(
      [[jude, "top"], [me, "bottom"], [newJude, "spotter"]].sort());
  });

  it("saves nothing from a batch with a link to someone else's item", async () => {
    const user = await newUser();
    const stranger = await newUser();
    const theirs = crypto.randomUUID();
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Theirs')", theirs, stranger.id).run();

    const res = await call("/api/data/import/ties", { method: "POST", cookie: user.cookie, body: { ties: [
      { title: "Fine", tie_type: "floor", tie_date: "2026-01-01", tags: ["would-be-new"] },
      { title: "Sneaky", tie_type: "floor", tie_date: "2026-01-01", participants: [{ person_id: theirs, role: "bottom" }] },
    ] } });
    expect(res).toEqual({ status: 400, body: { error: "Linked item not found." } });
    expect(await sql("SELECT count(*) AS n FROM ties WHERE owner_id = ?", user.id).first()).toEqual({ n: 0 });
    expect(await sql("SELECT count(*) AS n FROM tags WHERE owner_id = ?", user.id).first()).toEqual({ n: 0 });
  });

  it("refuses bad items with the item named, saving nothing", async () => {
    const user = await newUser();
    const res = await call("/api/data/import/items", { method: "POST", cookie: user.cookie, body: {
      people: [{ id: "a", name: "Fine" }], locations: [{ id: "l", name: "Bad link", maps_url: "javascript:alert(1)" }],
    } });
    expect(res).toEqual({ status: 400, body: { error: 'Locations 1 ("Bad link"): Expected a link starting with https://' } });
    expect(await sql("SELECT count(*) AS n FROM people WHERE owner_id = ?", user.id).first()).toEqual({ n: 0 });
  });

  it("refuses a body that's too big", async () => {
    const user = await newUser();
    const res = await call("/api/data/import/ties", { method: "POST", cookie: user.cookie, body: { ties: [{ title: "x".repeat(5 * 1024 * 1024) }] } });
    expect(res).toEqual({ status: 400, body: { error: "That's too much to import at once." } });
  });

  it("needs a signed-in user, from the app's own pages", async () => {
    expect((await call("/api/data/import/items", { method: "POST", body: {}, cookie: null })).status).toBe(401);
    expect((await call("/api/data/import/ties", { method: "POST", body: { ties: [] }, origin: "https://evil.example" })).status).toBe(403);
  });
});
