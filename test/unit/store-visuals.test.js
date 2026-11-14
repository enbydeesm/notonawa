// Visuals in format 2: an item's photos and videos (format v3 files, their
// keys in the item's record), drawings and poses (records of their own),
// and their one order (records/visuals.js); files no record lists
// (cache/orphans.js); and the v2 store's visuals and presets over a journal
// in memory, the Worker and the server mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  itemRef, captionOf, visualAdded, visualRemoved, fileCaptioned, visualsOrdered, mediaRows, drawnRows, findVisual,
} from "../../public/js/records/visuals.js";
import { orphanFiles } from "../../public/js/cache/orphans.js";
import { recordProblems } from "../../public/js/records/schema.js";

/** @type {Map<string, any>} */
const journal = new Map();
/** @type {any[]} */
const saved = [];
/** @type {any[]} */
const apiCalls = [];
vi.mock("../../public/js/store/v2/journal.js", () => ({
  records: (/** @type {string} */ kind) => [...journal.values()].filter((r) => r.kind === kind && r.body),
  record: (/** @type {string} */ id) => journal.get(id) ?? null,
  save: async (/** @type {any} */ batch) => {
    saved.push(batch);
    for (const w of batch.writes ?? []) journal.set(w.id, { kind: w.kind, id: w.id, version: 1, body: w.body });
    for (const d of batch.deletes ?? []) journal.delete(d.id);
  },
}));
vi.mock("../../public/js/api.js", () => ({
  api: async (/** @type {string} */ path, /** @type {any} */ options) => { apiCalls.push([path, options?.method ?? "GET", options?.body]); return null; },
}));
vi.mock("../../public/js/vault.js", () => ({
  sealFile: async (/** @type {string} */ fileId) => ({ key: `key-of-${fileId}`.padEnd(43, "x").slice(0, 43), body: new ArrayBuffer(8), thumbBytes: 3 }),
  openFile: async (/** @type {any} */ args) => args,
  copyFile: async (/** @type {any} */ args) => ({ key: "copied-key".padEnd(43, "x"), body: new ArrayBuffer(8), thumbBytes: 3, from: args }),
  reshareFile: async (/** @type {any} */ args) => ({ body: new ArrayBuffer(6), thumbBytes: 2, args }),
  adoptShareAsFile: async (/** @type {any} */ args) => ({ key: "adopted-key".padEnd(43, "x"), body: new ArrayBuffer(9), thumbBytes: 4, args }),
}));
// By a path in a variable: they load page modules the Node type check can't follow.
const VISUALS = "../../public/js/store/v2/visuals.js";
const PRESETS = "../../public/js/store/v2/presets.js";
/** @type {Record<string, (...args: any[]) => Promise<any>>} */
const store = await import(VISUALS);
/** @type {Record<string, (...args: any[]) => Promise<any>>} */
const presets = await import(PRESETS);

const NOW = "2026-11-14T12:00:00Z";
const KEY = "k".repeat(43);
/** @param {string} kind @param {string} id @param {Record<string, any>} body */
const entry = (kind, id, body) => ({ kind, id, version: 1, body });
/** @param {string} kind @param {string} id @param {Record<string, any>} body */
const put = (kind, id, body) => journal.set(id, entry(kind, id, body));
const TIE = { tie_date: "2026-11-14", tie_type: "floor" };

beforeEach(() => {
  journal.clear();
  saved.length = 0;
  apiCalls.length = 0;
});

describe("an item's visuals", () => {
  const photo = { kind: /** @type {const} */ ("file"), id: "f1", key: KEY, file_kind: "photo", mime: "image/jpeg", caption: "Front", created_at: NOW };
  const tie = entry("tie", "t1", { ...TIE, visuals: [photo, { kind: "drawing", id: "d1" }], cover: "d1" });

  it("are one list on the item: added last, captioned, removed (a cover that goes stops being one), and the kind's rules hold", () => {
    const added = visualAdded(tie, { kind: "pose", id: "q1" }, NOW);
    expect(added.body.visuals.map((/** @type {any} */ v) => v.id)).toEqual(["f1", "d1", "q1"]);
    expect(recordProblems("tie", added.body)).toEqual([]);
    expect(fileCaptioned(tie, "f1", null, NOW).body.visuals[0]).not.toHaveProperty("caption");
    const removed = visualRemoved(tie, "d1", NOW);
    expect([removed.body.visuals.length, removed.body.cover]).toEqual([1, undefined]);
    expect(visualRemoved(entry("tie", "t", { ...TIE, visuals: [photo] }), "f1", NOW).body).not.toHaveProperty("visuals");
  });

  it("are put in a new order only when every one is listed once", () => {
    expect(visualsOrdered(tie, [{ kind: "drawing", id: "d1" }, { kind: "media", id: "f1" }], NOW).body.visuals.map((/** @type {any} */ v) => v.id))
      .toEqual(["d1", "f1"]);
    for (const order of [[{ kind: "media", id: "f1" }], [{ kind: "media", id: "f1" }, { kind: "media", id: "d1" }],
      [{ kind: "media", id: "f1" }, { kind: "drawing", id: "d1" }, { kind: "drawing", id: "d1" }]]) {
      expect(() => visualsOrdered(tie, /** @type {any} */ (order), NOW)).toThrow(/changed meanwhile/);
    }
  });

  it("list as format 1's routes did, each with its place among all of them", () => {
    expect(mediaRows(tie)).toEqual([{ id: "f1", kind: "photo", mime: "image/jpeg", caption: "Front", position: 0, created_at: NOW }]);
    const drawing = entry("drawing", "d1", { data: { v: 1, strokes: [] }, caption: "Lines", created_at: NOW });
    expect(drawnRows(tie, "drawing", (id) => (id === "d1" ? drawing : null)))
      .toEqual([{ id: "d1", data: { v: 1, strokes: [] }, caption: "Lines", position: 1, created_at: NOW }]);
    expect(drawnRows(tie, "drawing", () => null)).toEqual([]);
    expect(findVisual([entry("plan", "p", { title: "P" }), tie], "f1")?.item.id).toBe("t1");
  });

  it("know their item, and keep captions to 1,000 characters", () => {
    expect([itemRef({ tie_id: "a" }), itemRef({ plan_id: "b" }), itemRef({ workshop_id: "c" })])
      .toEqual([{ kind: "tie", id: "a" }, { kind: "plan", id: "b" }, { kind: "workshop", id: "c" }]);
    expect([captionOf("  "), captionOf(" Hi ")]).toEqual([null, "Hi"]);
    expect(() => captionOf("x".repeat(1001))).toThrow(/1000/);
  });
});

describe("orphan files", () => {
  it("are the ones no record lists, a day old or more", () => {
    const files = [
      { id: "listed", created_at: "2026-11-01T00:00:00Z" }, { id: "picture", created_at: "2026-11-01T00:00:00Z" },
      { id: "old", created_at: "2026-11-01T00:00:00Z" }, { id: "new", created_at: "2026-11-14T11:00:00Z" },
    ];
    const bodies = [{ visuals: [{ kind: "file", id: "listed" }, { kind: "drawing", id: "old" }] }, { data: {}, picture: "picture" }];
    expect(orphanFiles(files, bodies, Date.parse(NOW))).toEqual(["old"]);
  });
});

describe("the v2 visuals store", () => {
  it("uploads a photo as a file, then lists it last on its item with its key", async () => {
    put("tie", "t1", { ...TIE, visuals: [{ kind: "drawing", id: "d1" }] });
    const id = await store.uploadPhoto({ item: { tie_id: "t1" }, prepared: { mime: "image/jpeg", thumb: new ArrayBuffer(3), full: new ArrayBuffer(5) },
      caption: " Front " });
    expect(apiCalls).toEqual([[`/api/files/${id}?kind=photo&thumb_bytes=3`, "PUT", expect.any(ArrayBuffer)]]);
    expect(journal.get("t1").body.visuals[1]).toMatchObject({ kind: "file", id, file_kind: "photo", mime: "image/jpeg", caption: "Front" });
    expect(await store.listMedia({ tie_id: "t1" })).toMatchObject([{ id, kind: "photo", position: 1, caption: "Front" }]);
    expect(await store.openMediaPart({ id }, "thumb")).toEqual({ fileId: id, key: journal.get("t1").body.visuals[1].key, part: "thumb" });
  });

  it("keeps each file's size, for the Share dialog's estimate", async () => {
    put("tie", "t1", TIE);
    const id = await store.uploadPhoto({ item: { tie_id: "t1" }, prepared: { mime: "image/jpeg", thumb: new ArrayBuffer(3), full: new ArrayBuffer(5) } });
    expect((await store.listMedia({ tie_id: "t1" }))[0]).toMatchObject({ id, bytes: 8 });
  });

  it("seals a file again for a share with its key from the record, and adds a share's file as a new one of mine", async () => {
    put("tie", "t1", { ...TIE, visuals: [{ kind: "file", id: "f1", key: KEY, file_kind: "photo", mime: "image/jpeg" }] });
    const object = await store.shareFileObject({ shareId: "sh", linkKey: "lk", file: { file: "s1", mediaId: "f1", kind: "photo" } });
    expect(object.args).toEqual({ shareId: "sh", key: "lk", fileId: "s1", sourceId: "f1", sourceKey: KEY, kind: "photo" });
    put("plan", "p1", { title: "P" });
    await store.adoptSharedMedia({ target: { plan_id: "p1" }, shareId: "sh", linkKey: "lk",
      visual: { file: "s1", kind: "photo", mime: "image/jpeg", caption: " Shared " } });
    const [adopted] = journal.get("p1").body.visuals;
    expect(adopted).toMatchObject({ kind: "file", file_kind: "photo", caption: "Shared", bytes: 9, key: "adopted-key".padEnd(43, "x") });
    expect(apiCalls.at(-1)).toEqual([`/api/files/${adopted.id}?kind=photo&thumb_bytes=4`, "PUT", expect.any(ArrayBuffer)]);
  });

  it("refuses a caption too long before anything's uploaded", async () => {
    put("tie", "t1", TIE);
    await expect(store.uploadPhoto({ item: { tie_id: "t1" }, prepared: { mime: "image/jpeg", thumb: new ArrayBuffer(1), full: new ArrayBuffer(1) },
      caption: "x".repeat(1001) })).rejects.toThrow(/1000/);
    expect(apiCalls).toEqual([]);
  });

  it("captions, copies and deletes a photo: the record first, then the file", async () => {
    put("tie", "t1", { ...TIE, visuals: [{ kind: "file", id: "f1", key: KEY, file_kind: "video", mime: "video/mp4" }] });
    put("plan", "p1", { title: "P" });
    await store.setMediaCaption("f1", "Spin");
    expect(journal.get("t1").body.visuals[0].caption).toBe("Spin");
    const copy = await store.copyMediaTo({ id: "f1", kind: "video", mime: "video/mp4", caption: "Spin" }, { plan_id: "p1" });
    expect(journal.get("p1").body.visuals).toMatchObject([{ id: copy, file_kind: "video", caption: "Spin" }]);
    apiCalls.length = 0;
    await store.deleteMedia("f1");
    expect(journal.get("t1").body.visuals).toBeUndefined();
    expect(apiCalls).toEqual([["/api/files/delete", "POST", { ids: ["f1"] }]]);
  });

  it("adds, changes, lists and deletes drawings and poses with their item, in one save each", async () => {
    put("workshop", "w1", { title: "W", start_date: "2026-11-14" });
    const id = await store.addDrawing({ workshop_id: "w1" }, { data: { v: 1, strokes: [] }, caption: "Tie-off" });
    expect(saved[0].writes.map((/** @type {any} */ w) => w.kind)).toEqual(["drawing", "workshop"]);
    await store.updateDrawing(id, { caption: "" });
    await store.updateDrawing(id, { data: { v: 1, strokes: [{ c: "red", w: 2, p: [1, 1] }] } });
    expect(await store.listDrawings({ workshop_id: "w1" })).toMatchObject([{ id, caption: null, position: 0, data: { strokes: [{ c: "red" }] } }]);
    const pose = await store.addPose({ workshop_id: "w1" }, { data: { v: 1, joints: {} }, caption: null });
    await store.setVisualOrder({ workshop_id: "w1" }, [{ kind: "pose", id: pose }, { kind: "drawing", id }]);
    expect(journal.get("w1").body.visuals.map((/** @type {any} */ v) => v.id)).toEqual([pose, id]);
    await store.deleteDrawing(id);
    expect([journal.has(id), journal.get("w1").body.visuals.map((/** @type {any} */ v) => v.id)]).toEqual([false, [pose]]);
    await expect(store.deletePose(id)).rejects.toThrow(/Not found/);
  });
});

describe("the v2 presets store", () => {
  it("adds, lists oldest first, renames, saves over and deletes, up to 50", async () => {
    const [a, b] = await presets.addPosePresets([{ kind: "arms", name: "Boxtie", data: { joints: {} } }, { kind: "body", name: " Kneel ", data: {} }]);
    expect((await presets.listPosePresets()).map((/** @type {any} */ p) => [p.kind, p.name])).toEqual([["arms", "Boxtie"], ["body", "Kneel"]]);
    // Saved together, they keep their order whatever order the journal holds them in.
    const [first, second] = [journal.get(a), journal.get(b)];
    journal.delete(a);
    journal.set(a, first);
    expect((await presets.listPosePresets()).map((/** @type {any} */ p) => p.id)).toEqual([a, b]);
    expect(second.body.order).toBe(1);
    await presets.renamePosePreset(a, "Box tie");
    await presets.setPosePresetData(b, { joints: { l_knee: [90] } });
    expect(journal.get(a).body.name).toBe("Box tie");
    expect(journal.get(b).body.data).toEqual({ joints: { l_knee: [90] } });
    await presets.deletePosePreset(a);
    await expect(presets.renamePosePreset(a, "x")).rejects.toThrow(/Not found/);
    await expect(presets.addPosePresets([{ kind: "legs", name: "x", data: {} }])).rejects.toThrow(/body or the arms/);
    await expect(presets.addPosePresets(Array.from({ length: 50 }, () => ({ kind: "body", name: "x", data: {} })))).rejects.toThrow(/up to 50/);
  });
});
