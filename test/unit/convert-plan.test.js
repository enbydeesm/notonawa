// Converting a format 1 journal (public/js/convert/plan.js): every item a
// record, its links and visuals folded in, every id worked out. The test
// the plan asks for: a journal with every kind and link, exported as
// format 1 does, converted, then exported again from the records as format
// 2 does, is the same journal. And the crypto Worker's convertMedia: a
// format 1 photo becomes a v3 file with the same bytes.
import { describe, it, expect } from "vitest";
import { idRequests, idKey, planConversion, keepWithinRules, withFileKeys } from "../../public/js/convert/plan.js";
import { journalExport } from "../../public/js/store/queries/export.js";
import { exportDocument } from "../../src/data/shape.js";
import { recordProblems } from "../../public/js/records/schema.js";
import { VaultCore } from "../../public/js/crypto/vault-core.js";
import { newRecoveryCode, readRecoveryCode } from "../../public/js/recovery.js";
import { rows, T1 } from "../journal-rows.js";

const NOW = "2026-11-14T12:00:00Z";
const KEY = "k".repeat(43);

/** The journal, with more than the shared one: a variation, a deleted plan on a tie, a second photo, a video. */
function journalRows() {
  return {
    ...rows,
    plans: [...rows.plans, { ...rows.plans[0], id: "tk2", title: "TK 2", variation_of: "tk", workshop_id: null }],
    tiePlans: [...rows.tiePlans, { tie_id: "t1", plan_id: null, plan_version: 3 }],
    media: [...rows.media,
      { id: "f2", tie_id: "t1", kind: "video", mime: "video/mp4", caption: null, position: 2, created_at: T1 },
      { id: "f3", plan_id: "tk", kind: "photo", mime: "image/jpeg", caption: "Plan shot", position: 1, created_at: T1 }],
  };
}

/** A worked-out id as the Worker would give it, but readable: `${table}_${oldId}`, made a valid id. */
const fakeId = (/** @type {string} */ table, /** @type {string} */ oldId) => `${table}_${oldId}`.replace(/[^A-Za-z0-9_-]/g, "-");

/** Ids worked out as the Worker would, but readable. */
function idsFor(/** @type {any} */ doc, /** @type {string[]} */ presetIds) {
  const requests = idRequests(doc, presetIds);
  return { requests, ids: { converted: new Map(requests.map((r) => [idKey(r.table, r.oldId), fakeId(r.table, r.oldId)])), self: "SELF", settings: "SETTINGS" } };
}

/** @param {import("../../public/js/convert/plan.js").PlannedRecord[]} records */
const byKind = (records) => {
  /** @type {Record<string, any[]>} */
  const out = {};
  for (const r of records) (out[r.kind] ??= []).push({ kind: r.kind, id: r.id, body: r.body });
  return out;
};

/**
 * An export with ids swapped for what they name, so the two formats'
 * exports compare: format 1's old ids, format 2's worked-out ones.
 * @param {any} doc
 */
function comparable(doc) {
  const names = new Map([
    ...doc.people.map((/** @type {any} */ p) => [p.id, `person:${p.name}`]), ...doc.locations.map((/** @type {any} */ l) => [l.id, `location:${l.name}`]),
    ...doc.plans.map((/** @type {any} */ p) => [p.id, `plan:${p.title}`]), ...doc.ties.map((/** @type {any} */ t) => [t.id, `tie:${t.title}`]),
  ]);
  const name = (/** @type {any} */ id) => (id === null ? null : names.get(id) ?? `?${id}`);
  const visuals = (/** @type {any} */ x) => ({
    photos: x.photos.map((/** @type {any} */ p) => [p.kind, p.mime, p.caption, p.position]),
    drawings: x.drawings.map((/** @type {any} */ d) => [d.data, d.caption, d.position]),
    poses: x.poses.map((/** @type {any} */ d) => [d.data, d.caption, d.position]),
  });
  const strip = (/** @type {any} */ x) => {
    const { id: _id, photos: _p, drawings: _d, poses: _q, ...rest } = x;
    return rest;
  };
  return {
    people: doc.people.map(strip),
    locations: doc.locations.map(strip),
    plans: doc.plans.map((/** @type {any} */ p) => ({ ...strip(p), variation_of: name(p.variation_of), ...visuals(p) })),
    tags: doc.tags,
    ties: doc.ties.map((/** @type {any} */ t) => ({ ...strip(t), location_id: name(t.location_id), ...visuals(t),
      participants: t.participants.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) })),
      plans: t.plans.map((/** @type {any} */ p) => ({ ...p, plan_id: name(p.plan_id) })) })),
    workshops: doc.workshops.map((/** @type {any} */ w) => ({ ...strip(w), location_id: name(w.location_id), ...visuals(w),
      educators: w.educators.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) })),
      participants: w.participants.map((/** @type {any} */ p) => ({ ...p, person_id: name(p.person_id) })),
      ties: w.ties.map(name), plans: w.plans.map(name) })),
  };
}

describe("planConversion", () => {
  const doc = exportDocument(/** @type {any} */ (journalRows()), NOW);
  const presetIds = ["preset-1"];
  const { requests, ids } = idsFor(doc, presetIds);
  const plan = planConversion(doc, presetIds, ids, NOW);
  const keys = new Map(plan.files.map((f) => [f.fileId, { key: KEY, bytes: 100 }]));
  const records = withFileKeys(plan.records, keys);

  it("converts the journal exactly: exported again from the records, it's the same", () => {
    const after = journalExport(/** @type {any} */ (byKind(records)));
    expect(comparable({ ...doc, ...after })).toEqual(comparable(doc));
    expect(after.pose_presets).toEqual(doc.account.pose_presets);
    expect(after.settings).toEqual({ top_label: "Rigger", bottom_label: null, default_shape: [50, 50, 50, 170] });
  });

  it("makes every record within its kind's rules, nothing unconverted", () => {
    for (const r of records) expect(recordProblems(r.kind, r.body, { id: r.id }), `${r.kind} ${r.id}`).toEqual([]);
    expect(plan.unconverted).toBe(0);
  });

  it("gives Me and the settings their fixed ids, and works out every other id, once each", () => {
    expect(records.find((r) => r.kind === "person" && r.body.is_self)?.id).toBe("SELF");
    expect(records.filter((r) => r.kind === "settings").map((r) => r.id)).toEqual(["SETTINGS"]);
    const all = records.map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(requests.map((r) => idKey(r.table, r.oldId))).size).toBe(requests.length);
    // A tie's links to Me use Me's fixed id.
    const workshop = records.find((r) => r.kind === "workshop");
    expect(workshop?.body.people).toEqual([{ person_id: "people_sam", kind: "educator", role: "top" }]);
  });

  it("is the same every time, so a run that's started again writes the same records", () => {
    const again = planConversion(doc, presetIds, ids, NOW);
    expect(withFileKeys(again.records, keys)).toEqual(records);
    expect(again.files).toEqual(plan.files);
  });

  it("lists each photo and video to convert, on its item, in the visuals' order", () => {
    expect(plan.files.map((f) => [f.mediaId, f.kind, f.recordId])).toEqual([
      ["f3", "photo", "plans_tk"], ["f1", "photo", "ties_t1"], ["f2", "video", "ties_t1"]]);
    const tie = records.find((r) => r.id === "ties_t1");
    expect(tie?.body.visuals.map((/** @type {any} */ v) => [v.kind, v.id])).toEqual([
      ["file", "media_f1"], ["drawing", "drawings_d1"], ["file", "media_f2"]]);
    expect(tie?.body.visuals[0]).toMatchObject({ key: KEY, bytes: 100, caption: "Front" });
  });

  it("needs every file's key before saving", () => {
    expect(() => withFileKeys(plan.records, new Map())).toThrow(/wasn't converted/);
  });
});

describe("keepWithinRules", () => {
  it("moves a field that breaks a rule into unconverted, keeping it", () => {
    const record = { kind: /** @type {const} */ ("tie"), id: "t", body: { tie_date: "2026-01-01", tie_type: "floor", title: "x".repeat(300), success_rating: 9 } };
    expect(keepWithinRules(record)).toBe(true);
    expect(record.body).toEqual({ tie_date: "2026-01-01", tie_type: "floor", unconverted: { title: "x".repeat(300), success_rating: 9 } });
  });

  it("refuses one missing what it must have", () => {
    expect(() => keepWithinRules({ kind: "tie", id: "t", body: { tie_type: "floor" } })).toThrow(/tie_date is needed/);
  });
});

describe("convertMedia", () => {
  it("turns a format 1 photo into a v3 file with the same bytes, under a new key", async () => {
    /** @type {Map<string, ArrayBuffer>} */
    const v1 = new Map();
    /** @type {Map<string, { body: ArrayBuffer, thumbBytes: number }>} */
    const v3 = new Map();
    const vault = new VaultCore(undefined,
      async (mediaId, part) => /** @type {ArrayBuffer} */ (v1.get(`${mediaId}|${part}`)),
      undefined,
      async (fileId, part) => {
        const f = /** @type {{ body: ArrayBuffer, thumbBytes: number }} */ (v3.get(fileId));
        return part === "thumb" ? f.body.slice(0, f.thumbBytes) : f.body.slice(f.thumbBytes);
      });
    await vault.setup({ userId: "me", code: /** @type {string} */ (readRecoveryCode(newRecoveryCode())) });
    const thumb = new Uint8Array(20).fill(1);
    const full = new Uint8Array(500).fill(2);
    const sealed = await vault.sealPhoto({ mediaId: "m1", thumb: thumb.slice().buffer, full: full.slice().buffer });
    v1.set("m1|thumb", sealed.body.slice(0, sealed.thumbBytes));
    v1.set("m1|full", sealed.body.slice(sealed.thumbBytes));
    const file = await vault.convertMedia({ mediaId: "m1", kind: "photo", newFileId: "f1" });
    v3.set("f1", file);
    expect(new Uint8Array(await vault.openFile({ fileId: "f1", key: file.key, part: "thumb" }))).toEqual(thumb);
    expect(new Uint8Array(await vault.openFile({ fileId: "f1", key: file.key, part: "full" }))).toEqual(full);
  });
});
