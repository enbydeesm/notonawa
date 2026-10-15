import { describe, it, expect } from "vitest";
import { call, create, createOtherUser, sessionCookieFor, signedInUser, sql, sealed } from "../helpers.js";
import { duplicatePositions } from "../../public/js/import-dedupe.js";
import { convertJournal } from "../../public/js/journal-fields.js";
import { readExport, itemsBody, remapTies, batches } from "../../public/js/import-steps.js";
import { parseCsv } from "../../public/js/csv.js";
import { csvToImport } from "../../public/js/import-csv.js";
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
  const fields = { person: ["notes"], profileNote: ["description"], location: ["notes"], plan: ["description", "notes"], tie: ["notes"], participant: ["notes"] };
  return convertJournal(doc, async (kind, records) => records.map((r) => {
    const out = { ...r };
    for (const f of fields[kind]) if (typeof r[f] === "string" && !r[f].startsWith("e1.")) out[f] = sealed(r[f].trim());
    return out;
  }));
}

/**
 * Imports a file the way the page does: items, then ties in batches, each
 * checked for duplicates first (candidates from the server, notes compared
 * here), sending which to skip.
 * @param {any} file
 * @param {string} cookie
 * @param {number} [batchSize]
 */
async function importFile(file, cookie, batchSize) {
  const doc = await sealFile(readExport(file));
  const items = await call("/api/data/import/items", { method: "POST", body: itemsBody(doc, false), cookie });
  expect(items.status, JSON.stringify(items.body)).toBe(200);
  let added = 0;
  let skipped = 0;
  for (const ties of batches(remapTies(doc.ties, items.body), batchSize)) {
    const preview = await call("/api/data/import/ties", { method: "POST", body: { preview: true, ties }, cookie });
    const skip = duplicatePositions(ties, preview.body.candidates);
    const res = await call("/api/data/import/ties", { method: "POST", body: { ties, skip }, cookie });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    added += res.body.added;
    skipped += res.body.skipped;
  }
  return { items: items.body, added, skipped };
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
    ...doc.people.map((/** @type {any} */ p) => [p.id, `person:${p.name}`]),
    ...doc.locations.map((/** @type {any} */ l) => [l.id, `location:${l.name}`]),
    ...doc.plans.map((/** @type {any} */ p) => [p.id, `plan:${p.title}`]),
  ]);
  const name = (/** @type {string | null} */ id) => (id === null ? null : names.get(id));
  const byText = (/** @type {any[]} */ list) => list.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    people: byText(doc.people.map(({ id: _id, ...p }) => p)),
    locations: byText(doc.locations.map(({ id: _id, ...l }) => l)),
    plans: byText(doc.plans.map(({ id: _id, ...p }) => ({ ...p, variation_of: name(p.variation_of) }))),
    tags: doc.tags,
    ties: byText(doc.ties.map(({ id: _id, ...t }) => ({
      ...t,
      location_id: name(t.location_id),
      participants: byText(t.participants.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) }))),
      plans: byText(t.plans.map((/** @type {any} */ p) => ({ ...p, plan_id: name(p.plan_id) }))),
    }))),
  };
}

/** Fills the signed-in test user's journal with linked, archived and deleted things. */
async function fillJournal() {
  const me = await create("/api/people", { name: "Me", is_self: true });
  const sam = await create("/api/people", { name: "Sam", pronouns: "they/them", notes: sealed("Floor work"), default_role: "model" });
  const gone = await create("/api/people", { name: "Gone" });
  await call(`/api/people/${sam}/archive`, { method: "POST" });
  await sql("INSERT INTO profile_notes (id, person_id, type, description, noted_on) VALUES (?, ?, 'injury', ?, '2026-01-02')",
    crypto.randomUUID(), sam, sealed("Left shoulder")).run();
  const studio = await create("/api/locations", { name: "Studio", notes: sealed("Beam"), latitude: 51.5, longitude: -0.12 });
  const old = await create("/api/locations", { name: "Old flat" });
  const tk = await create("/api/plans", { title: "TK", stage: "ready", est_difficulty: 3 });
  const tk2 = await create("/api/plans", { title: "TK 2", variation_of: tk });
  const dropped = await create("/api/plans", { title: "Dropped" });
  await call(`/api/plans/${tk}`, { method: "PUT", body: { title: "TK", stage: "ready", est_difficulty: 3 } });
  await sql("UPDATE plans SET version = 4 WHERE id = ?", tk).run();
  await create("/api/ties", {
    title: "Floor", tie_date: "2026-10-01", tie_type: "partial suspension", notes: sealed("Went well"), success_rating: 4, duration_minutes: 50, location_id: studio,
    participants: [{ person_id: me, role: "rigger" }, { person_id: sam, role: "model" }, { person_id: gone, role: "spotter" }],
    plan_ids: [tk, tk2, dropped], tags: ["floor", "Futomomo"],
  });
  await create("/api/ties", { title: "At the old flat", tie_date: "2026-09-01", location_id: old });
  await create("/api/ties", { tie_date: "2026-01-01", title: "No date" });
  for (let i = 0; i < 5; i++) await create("/api/ties", { title: `Practice ${i}`, tie_date: `2026-08-0${i + 1}` });
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
    expect([first.added, first.skipped]).toEqual([8, 0]);
    const copy = await exportOf(other.cookie);
    expect(comparable(copy)).toEqual(comparable(original));
    // Fresh ids: nothing in the copy shares an id with the original.
    expect(copy.ties.map((/** @type {any} */ t) => t.id)).not.toContain(original.ties[0].id);

    const again = await importFile(original, other.cookie);
    expect([again.added, again.skipped]).toEqual([0, 8]);
    expect(again.items.people.every((/** @type {any} */ p) => p.matched)).toBe(true);
    expect(comparable(await exportOf(other.cookie))).toEqual(comparable(original));
  });

  it("previews without saving anything", async () => {
    const user = await newUser();
    await call("/api/people", { method: "POST", body: { name: "sam" }, cookie: user.cookie });
    await call("/api/ties", { method: "POST", body: { title: "Floor", tie_date: "2026-10-01" }, cookie: user.cookie });

    const items = await call("/api/data/import/items", { method: "POST", cookie: user.cookie, body: {
      preview: true, people: [{ id: "a", name: "Sam" }, { id: "b", name: "Alex" }], tags: ["new tag"],
    } });
    expect(items.body).toEqual({
      people: [
        { file_id: "a", name: "Sam", id: expect.any(String), matched: true },
        { file_id: "b", name: "Alex", id: null, matched: false },
      ],
      locations: [], plans: [], new_tags: ["new tag"],
    });
    const ties = await call("/api/data/import/ties", { method: "POST", cookie: user.cookie, body: {
      preview: true, ties: [{ title: "New", tie_date: "2026-10-02" }, { title: "Floor", tie_date: "2026-10-01" }, { title: "x", tie_date: "2026-10-03", tags: ["t"] }],
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
      participants: [{ person_id: sam, role: "model" }, { person_id: alex, role: "rigger" }],
      plan_ids: [plan], tags: ["Floor", "kata"],
    };
    // Two untitled ties on the same day with no notes, told apart by their people.
    await add("/api/ties", saved);
    await add("/api/ties", { ...saved, participants: [{ person_id: sam, role: "model" }] });

    // As the export writes it: plans as objects, tags in any order and capitals.
    const same = {
      ...saved, plan_ids: undefined, plans: [{ plan_id: plan, plan_version: 1 }],
      participants: [...saved.participants].reverse(), tags: ["KATA", "floor"],
    };
    /** @type {Record<string, any>[]} */
    const variants = [
      same,
      { ...same, participants: [{ person_id: alex, role: "model" }] },
      { ...same, tags: ["floor"] },
      { ...same, tags: [...same.tags, "brand new"] },
      { ...same, plans: [] },
      { ...same, tie_type: "suspension" },
      { ...same, location_id: null },
      { ...same, duration_minutes: 31 },
      { ...same, success_rating: null },
      { ...same, tie_date: "2026-10-02" },
      { ...same, participants: [{ person_id: sam, role: "model" }] },
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

  it("imports the CSV template, matching names to the journal's", async () => {
    const user = await newUser();
    const post = async (/** @type {string} */ path, /** @type {any} */ body) =>
      (await call(path, { method: "POST", body, cookie: user.cookie })).body.id;
    const sam = await post("/api/people", { name: "sam" });
    const plan = await post("/api/plans", { title: "Hip harness" });
    await sql("UPDATE plans SET version = 2 WHERE id = ?", plan).run();

    const { doc, errors } = csvToImport(parseCsv(template));
    expect(errors).toEqual([]);
    const result = await importFile({ format: "rope-journal-export", version: 1, ...doc }, user.cookie);
    expect([result.added, result.skipped]).toEqual([1, 0]);
    expect(result.items.people.map((/** @type {any} */ p) => [p.name, p.matched])).toEqual([["Sam", true], ["Alex", false]]);

    const [tie] = (await call("/api/ties/search", { method: "POST", body: {}, cookie: user.cookie })).body.ties;
    expect(tie).toMatchObject({
      title: "Floor practice", tie_date: "2026-10-12", tie_type: "floor", duration_minutes: 45, success_rating: 4,
      location_name: "Studio", notes: sealed("Went well. Notes can have commas, in quotes."),
      plans: [{ plan_id: plan, plan_title: "Hip harness", plan_version: 2 }],
    });
    expect(tie.participants).toEqual(expect.arrayContaining([
      { id: expect.any(String), person_id: sam, person_name: "sam", role: "model" },
      expect.objectContaining({ person_name: "Alex", role: "rigger" }),
    ]));
    const tags = (await call("/api/tags", { cookie: user.cookie })).body.map((/** @type {any} */ t) => t.name).sort();
    expect(tags).toEqual(["floor", "practice"]);
  });

  it("uses each plan's current version when the file doesn't say", async () => {
    const user = await newUser();
    const items = await importFile({
      format: "rope-journal-export", version: 1,
      plans: [{ id: "p", title: "TK", version: 3 }],
      ties: [{ title: "Tie", tie_date: "2026-01-01", plans: [{ plan_id: "p" }] }],
    }, user.cookie);
    expect(await sql("SELECT plan_version FROM tie_plans WHERE plan_id = ?", items.items.plans[0].id).first())
      .toEqual({ plan_version: 3 });
  });

  it("saves nothing from a batch with a link to someone else's item", async () => {
    const user = await newUser();
    const stranger = await newUser();
    const theirs = crypto.randomUUID();
    await sql("INSERT INTO people (id, owner_id, name) VALUES (?, ?, 'Theirs')", theirs, stranger.id).run();

    const res = await call("/api/data/import/ties", { method: "POST", cookie: user.cookie, body: { ties: [
      { title: "Fine", tie_date: "2026-01-01", tags: ["would-be-new"] },
      { title: "Sneaky", tie_date: "2026-01-01", participants: [{ person_id: theirs, role: "model" }] },
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
