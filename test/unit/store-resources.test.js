// People and locations as the pages have them (format 2): the rows
// (store/queries/resources.js) and the v2 store's functions over a journal
// in memory (store/v2/resources.js), with the same shape and order as
// format 1's API, and maps.js kept the same as the server's.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listPeople, listLocations, personRow, locationRow, passesArchived } from "../../public/js/store/queries/resources.js";
import { RESOURCES } from "../../src/resources/config.js";
import * as deviceMaps from "../../public/js/maps.js";
import * as serverMaps from "../../src/locations/maps.js";

/** @type {Map<string, any>} */
const journal = new Map();
/** @type {any[]} */
const saved = [];
vi.mock("../../public/js/store/v2/journal.js", () => ({
  records: (/** @type {string} */ kind) => [...journal.values()].filter((r) => r.kind === kind && r.body),
  record: (/** @type {string} */ id) => journal.get(id) ?? null,
  save: async (/** @type {any} */ batch) => {
    saved.push(batch);
    for (const w of batch.writes ?? []) journal.set(w.id, { kind: w.kind, id: w.id, version: 1, body: w.body });
    for (const d of batch.deletes ?? []) journal.delete(d.id);
  },
}));
/** @type {any[]} */
const apiCalls = [];
vi.mock("../../public/js/api.js", () => ({
  api: async (/** @type {string} */ path, /** @type {any} */ options) => { apiCalls.push([path, options?.body]); return { latitude: 1, longitude: 2 }; },
}));
// Imported by a path in a variable: these load page modules (the journal,
// api.js) that the Node type check can't follow, mocked above.
const STORE = "../../public/js/store/v2/resources.js";
const MAPS = "../../public/js/store/maps.js";
const TAGS = "../../public/js/store/v2/tags.js";
/** @type {Record<"listTags" | "deleteTag", (...args: any[]) => Promise<any>>} */
const tagStore = await import(TAGS);
/** @type {Record<"listItems" | "saveItem" | "archiveItem" | "restoreItem" | "deleteItem" | "deletePlan", (...args: any[]) => Promise<any>>} */
const store = await import(STORE);
/** @type {{ mapLinkCoords: (link: string) => Promise<{ latitude: number | null, longitude: number | null }> }} */
const { mapLinkCoords } = await import(MAPS);

/** @param {string} kind @param {string} id @param {Record<string, any>} body */
const put = (kind, id, body) => journal.set(id, { kind, id, version: 1, body });

beforeEach(() => {
  journal.clear();
  saved.length = 0;
});

/** @param {string} columns */
const columnNames = (columns) => columns.split(",").map((c) => c.trim());

describe("rows", () => {
  it("have exactly format 1's columns", () => {
    expect(Object.keys(personRow({ kind: "person", id: "p", body: {} }))).toEqual(columnNames(RESOURCES.people.columns));
    expect(Object.keys(locationRow({ kind: "location", id: "l", body: {} }))).toEqual(columnNames(RESOURCES.locations.columns));
  });

  it("list me first, then by name ignoring capitals, filtered by archived", () => {
    const people = [
      { kind: "person", id: "b", body: { name: "bea" } },
      { kind: "person", id: "a", body: { name: "Alex", archived_at: "2026-01-01T00:00:00Z" } },
      { kind: "person", id: "me", body: { name: "Zed", is_self: true } },
      { kind: "person", id: "c", body: { name: "Cat", aliases: [{ platform: "scene", alias: "kitty" }] } },
    ];
    expect(listPeople(people, false).map((p) => p.id)).toEqual(["me", "b", "c"]);
    expect(listPeople(people, "true").map((p) => p.id)).toEqual(["a"]);
    expect(listPeople(people, "all").map((p) => [p.id, p.is_self])).toEqual([["me", 1], ["a", 0], ["b", 0], ["c", 0]]);
    expect(listPeople(people, "all")[3].aliases).toBe(JSON.stringify([{ platform: "scene", alias: "kitty" }]));
    expect(listLocations([{ kind: "location", id: "x", body: { name: "b" } }, { kind: "location", id: "y", body: { name: "A" } }], false)
      .map((l) => l.name)).toEqual(["A", "b"]);
  });

  it("need the archived filter", () => {
    expect(() => passesArchived({ archived_at: null }, /** @type {any} */ (undefined))).toThrow(/archived=/);
  });
});

describe("the v2 store", () => {
  it("adds and edits a person, keeping what the form doesn't have", async () => {
    const id = await store.saveItem("people", null, { name: "Sam", default_role: "bottom" });
    put("person", id, { ...journal.get(id).body, profile_notes: [] });
    await store.saveItem("people", id, { name: "Sam K", default_role: "top" });
    expect(journal.get(id).body).toMatchObject({ name: "Sam K", default_role: "top", profile_notes: [] });
    expect(saved[1].writes[0].from).toMatchObject({ name: "Sam" });
    expect((await store.listItems("people", false)).map((p) => p.name)).toEqual(["Sam K"]);
  });

  it("allows one me", async () => {
    put("person", "me", { name: "Me", is_self: true });
    await expect(store.saveItem("people", null, { name: "Also me", is_self: true })).rejects.toThrow(/already/);
    await expect(store.archiveItem("people", "me")).rejects.toThrow(/can't be deleted or archived/);
    await expect(store.deleteItem("people", "me")).rejects.toThrow(/can't be deleted or archived/);
  });

  it("makes one location the default in place of the old, in one batch", async () => {
    put("location", "home", { name: "Home", is_default: true });
    const id = await store.saveItem("locations", null, { name: "Studio", is_default: true });
    expect(saved[0].writes.map((/** @type {any} */ w) => [w.id, w.body.is_default])).toEqual([["home", false], [id, true]]);
    expect((await store.listItems("locations", false)).filter((l) => l.is_default).map((l) => l.id)).toEqual([id]);
  });

  it("archives and restores", async () => {
    put("location", "home", { name: "Home", is_default: true });
    await store.archiveItem("locations", "home");
    expect(await store.listItems("locations", false)).toEqual([]);
    expect((await store.listItems("locations", true))[0]).toMatchObject({ is_default: 0 });
    await store.restoreItem("locations", "home");
    expect((await store.listItems("locations", false)).map((l) => l.id)).toEqual(["home"]);
  });

  it("deletes a person, leaving their ties' places, in the same batch", async () => {
    put("person", "sam", { name: "Sam" });
    put("tie", "t1", { tie_date: "2026-11-14", tie_type: "floor", participants: [{ person_id: "sam", role: "bottom" }] });
    await store.deleteItem("people", "sam");
    expect(saved[0]).toMatchObject({ writes: [{ id: "t1" }], deletes: [{ kind: "person", id: "sam" }] });
    expect(journal.get("t1").body.participants).toEqual([{ person_id: null, role: "bottom" }]);
  });

  it("saves a plan with its tags, new ones made in the same batch, and deletes it with its drawings", async () => {
    put("tag", "t-box", { name: "Box" });
    const id = await store.saveItem("plans", null, { title: "TK", tags: ["box", "Ebi"] });
    expect(saved[0].writes.map((/** @type {any} */ w) => w.kind)).toEqual(["tag", "plan"]);
    const tags = journal.get(id).body.tags;
    expect([tags[0], journal.get(tags[1]).body.name]).toEqual(["t-box", "Ebi"]);
    expect((await store.listItems("plans", false))[0]).toMatchObject({ title: "TK", tags: ["Box", "Ebi"] });
    put("drawing", "d1", { data: { v: 1, strokes: [] } });
    put("plan", id, { ...journal.get(id).body, visuals: [{ kind: "drawing", id: "d1" }, { kind: "drawing", id: "never-synced" }] });
    put("tie", "t1", { tie_date: "2026-11-14", tie_type: "floor", plans: [{ plan_id: id, plan_version: 1 }] });
    await store.deletePlan(id, "remove");
    expect(saved[1]).toMatchObject({ writes: [{ id: "t1" }], deletes: [{ id: "d1" }, { id }] });
    expect(journal.get("t1").body.plans).toEqual([]);
  });

  it("deletes a tag from everything it's on, in one batch", async () => {
    put("tag", "x", { name: "Box" });
    put("plan", "p", { title: "P", tags: ["x"] });
    expect((await tagStore.listTags()).map((/** @type {any} */ t) => [t.name, t.plan_count])).toEqual([["Box", 1]]);
    await tagStore.deleteTag("x");
    expect(saved[0]).toMatchObject({ writes: [{ id: "p", body: { tags: [] } }], deletes: [{ kind: "tag", id: "x" }] });
    await expect(tagStore.deleteTag("p")).rejects.toThrow(/Not found/);
  });

  it("refuses another kind's id", async () => {
    put("location", "l1", { name: "L" });
    await expect(store.archiveItem("people", "l1")).rejects.toThrow(/Not found/);
  });
});

describe("maps.js", () => {
  it("is the server's, function for function", () => {
    expect(Object.keys(deviceMaps).sort()).toEqual(Object.keys(serverMaps).sort());
    for (const name of Object.keys(serverMaps)) {
      expect(String(/** @type {any} */ (deviceMaps)[name]), name).toBe(String(/** @type {any} */ (serverMaps)[name]));
    }
  });
});

describe("mapLinkCoords", () => {
  it("reads a full link on the device, sending it nowhere", async () => {
    apiCalls.length = 0;
    expect(await mapLinkCoords("https://www.google.com/maps/place/Studio/@51.5,-0.12,17z")).toEqual({ latitude: 51.5, longitude: -0.12 });
    expect(await mapLinkCoords("https://maps.google.com/?q=Studio")).toEqual({ latitude: null, longitude: null });
    expect(apiCalls).toEqual([]);
  });

  it("asks the server to follow a short link, and refuses what isn't a maps link", async () => {
    apiCalls.length = 0;
    expect(await mapLinkCoords("https://maps.app.goo.gl/abc123")).toEqual({ latitude: 1, longitude: 2 });
    expect(apiCalls).toEqual([["/api/locations/coords", { url: "https://maps.app.goo.gl/abc123" }]]);
    await expect(mapLinkCoords("https://example.com/maps")).rejects.toThrow(/isn't a Google Maps link/);
    await expect(mapLinkCoords("not a link")).rejects.toThrow(/Paste/);
  });
});
