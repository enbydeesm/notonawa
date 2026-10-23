import { describe, it, expect } from "vitest";
import { exportDocument, exportFileName } from "../../src/data/shape.js";

/** @type {import("../../src/data/shape.js").AccountRows} */
const EMPTY = {
  user: { created_at: "2026-01-01T00:00:00Z", accepted_at: "2026-01-01T00:00:00Z", terms_version: "1" },
  passkeys: [], people: [], profileNotes: [], locations: [], plans: [], planTags: [], tags: [],
  ties: [], participants: [], tiePlans: [], tieTags: [], workshops: [], workshopPeople: [], workshopTags: [],
  media: [], drawings: [], poses: [], notices: [], feedback: [],
};

describe("exportDocument", () => {
  it("lists each tie's and plan's photos, in order, with where each file goes in the zip", () => {
    const doc = exportDocument({
      ...EMPTY,
      ties: [{ id: "t1" }],
      plans: [{ id: "p1" }],
      media: [
        { id: "m2", tie_id: "t1", plan_id: null, kind: "photo", mime: "image/jpeg", caption: null, position: 0, created_at: "2026-10-02T00:00:00Z" },
        { id: "m1", tie_id: "t1", plan_id: null, kind: "photo", mime: "image/webp", caption: "e1.x.y", position: 1, created_at: "2026-10-01T00:00:00Z" },
        { id: "m3", tie_id: null, plan_id: "p1", kind: "photo", mime: "image/webp", caption: null, position: 0, created_at: "2026-10-03T00:00:00Z" },
      ],
    }, "2026-10-13T10:00:00Z");
    expect(doc.ties[0].photos).toEqual([
      { id: "m2", kind: "photo", mime: "image/jpeg", file: "photos/m2.jpg", caption: null, position: 0, created_at: "2026-10-02T00:00:00Z" },
      { id: "m1", kind: "photo", mime: "image/webp", file: "photos/m1.webp", caption: "e1.x.y", position: 1, created_at: "2026-10-01T00:00:00Z" },
    ]);
    expect(doc.plans[0].photos.map((/** @type {any} */ p) => p.file)).toEqual(["photos/m3.webp"]);
  });

  it("lists workshops with their educators, participants, tags and photos", () => {
    const doc = exportDocument({
      ...EMPTY,
      workshops: [{
        id: "w1", title: "Intro", start_date: "2026-03-01", end_date: null, location_id: null, location_deleted: 1,
        attendee_count: 9, rating: 4, description: "e1.d", notes: null, album_url: null,
        created_at: "2026-03-01T00:00:00Z", updated_at: "2026-03-01T00:00:00Z",
      }],
      workshopPeople: [
        { workshop_id: "w1", person_id: "kit", kind: "educator", role: "top" },
        { workshop_id: "w1", person_id: null, kind: "participant", role: "bottom" },
      ],
      workshopTags: [{ workshop_id: "w1", name: "floor" }],
      media: [{ id: "m1", tie_id: null, plan_id: null, workshop_id: "w1", kind: "photo", mime: "image/webp", caption: null, position: 0, created_at: "2026-03-01T00:00:00Z" }],
    }, "2026-10-13T10:00:00Z");
    expect(doc.workshops).toEqual([{
      id: "w1", title: "Intro", start_date: "2026-03-01", end_date: null, location_id: null, location_deleted: true,
      attendee_count: 9, rating: 4, description: "e1.d", notes: null, album_url: null,
      created_at: "2026-03-01T00:00:00Z", updated_at: "2026-03-01T00:00:00Z",
      educators: [{ person_id: "kit", role: "top" }], participants: [{ person_id: null, role: "bottom" }],
      tags: ["floor"],
      photos: [{ id: "m1", kind: "photo", mime: "image/webp", file: "photos/m1.webp", caption: null, position: 0, created_at: "2026-03-01T00:00:00Z" }],
      drawings: [],
      poses: [],
    }]);
  });

  it("lists each tie's, plan's and workshop's drawings, their lines as JSON, with where each picture goes in the zip", () => {
    const lines = { v: 1, strokes: [{ c: "red", w: 2, p: [1, 2, 3, 4] }] };
    const row = (/** @type {string} */ id, /** @type {Record<string, string | null>} */ item, position = 0) => ({
      id, tie_id: null, plan_id: null, workshop_id: null, ...item, data: JSON.stringify(lines), caption: null,
      position, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z",
    });
    const doc = exportDocument({
      ...EMPTY,
      ties: [{ id: "t1", title: "A" }],
      plans: [{ id: "pl1", title: "TK" }],
      workshops: [{ id: "w1", title: "Intro" }],
      drawings: [row("d1", { tie_id: "t1" }), { ...row("d2", { tie_id: "t1" }, 1), caption: "e1.x.y" },
        row("d3", { plan_id: "pl1" }), row("d4", { workshop_id: "w1" })],
    }, "2026-10-13T10:00:00Z");
    expect(doc.ties[0].drawings).toEqual([
      { id: "d1", data: lines, file: "drawings/d1.svg", caption: null, position: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" },
      { id: "d2", data: lines, file: "drawings/d2.svg", caption: "e1.x.y", position: 1, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" },
    ]);
    expect(doc.plans[0].drawings.map((/** @type {any} */ d) => d.id)).toEqual(["d3"]);
    expect(doc.workshops[0].drawings.map((/** @type {any} */ d) => d.id)).toEqual(["d4"]);
  });

  it("lists each tie's, plan's and workshop's poses, their data as JSON", () => {
    const data = { v: 1, joints: { l_knee: [30] }, body: [0, 0, 0], lift: 99, camera: [0, 0, 300, 100], ring: null, ropes: [] };
    const row = (/** @type {string} */ id, /** @type {Record<string, string | null>} */ item, position = 0) => ({
      id, tie_id: null, plan_id: null, workshop_id: null, ...item, data: JSON.stringify(data), caption: null,
      position, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z",
    });
    const doc = exportDocument({
      ...EMPTY,
      ties: [{ id: "t1", title: "A" }],
      plans: [{ id: "pl1", title: "TK" }],
      workshops: [{ id: "w1", title: "Intro" }],
      poses: [row("p1", { tie_id: "t1" }), { ...row("p2", { tie_id: "t1" }, 1), caption: "e1.x.y" },
        row("p3", { plan_id: "pl1" }), row("p4", { workshop_id: "w1" })],
    }, "2026-10-13T10:00:00Z");
    expect(doc.ties[0].poses).toEqual([
      { id: "p1", data, caption: null, position: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" },
      { id: "p2", data, caption: "e1.x.y", position: 1, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" },
    ]);
    expect(doc.plans[0].poses.map((/** @type {any} */ d) => d.id)).toEqual(["p3"]);
    expect(doc.workshops[0].poses.map((/** @type {any} */ d) => d.id)).toEqual(["p4"]);
  });

  it("labels the file with its format, version and time", () => {
    expect(exportDocument(EMPTY, "2026-10-13T10:00:00Z")).toMatchObject({
      format: "notonawa-export", version: 1, exported_at: "2026-10-13T10:00:00Z",
      account: { created_at: "2026-01-01T00:00:00Z", terms_version: "1", recovery_email_set: false, passkeys: [], notices: [], feedback: [] },
      people: [], locations: [], plans: [], tags: [], ties: [],
    });
  });

  it("nests each tie's participants, plans and tags, and turns flags into true/false", () => {
    const doc = exportDocument({
      ...EMPTY,
      ties: [
        { id: "t1", title: "A", location_id: null, location_deleted: 1 },
        { id: "t2", title: "B", location_id: "l1", location_deleted: 0 },
      ],
      participants: [
        { tie_id: "t1", person_id: null, role: "bottom", difficulty_rating: 3, experience_rating: null, notes: "n" },
        { tie_id: "t2", person_id: "p1", role: "top", difficulty_rating: null, experience_rating: 4, notes: null },
      ],
      tiePlans: [{ tie_id: "t1", plan_id: "pl1", plan_version: 2 }],
      tieTags: [{ tie_id: "t2", name: "floor" }, { tie_id: "t2", name: "Futomomo" }],
    }, "2026-10-13T10:00:00Z");

    expect(doc.ties[0]).toMatchObject({
      id: "t1", location_deleted: true,
      participants: [{ person_id: null, role: "bottom", difficulty_rating: 3, experience_rating: null, notes: "n" }],
      plans: [{ plan_id: "pl1", plan_version: 2 }], tags: [], photos: [],
    });
    expect(doc.ties[1]).toMatchObject({
      id: "t2", location_id: "l1", location_deleted: false,
      participants: [{ person_id: "p1", role: "top" }], plans: [], tags: ["floor", "Futomomo"],
    });
  });

  it("nests profile notes under people and tags under plans", () => {
    const doc = exportDocument({
      ...EMPTY,
      people: [{ id: "p1", name: "Sam", is_self: 0 }, { id: "p2", name: "Me", is_self: 1 }],
      profileNotes: [{ person_id: "p1", type: "limit", description: "No neck ties", noted_on: null, is_current: 1 }],
      plans: [{ id: "pl1", title: "TK" }],
      planTags: [{ plan_id: "pl1", name: "box tie" }],
    }, "2026-10-13T10:00:00Z");
    expect(doc.people[0]).toMatchObject({
      is_self: false, profile_notes: [{ type: "limit", description: "No neck ties", is_current: true }],
    });
    expect(doc.people[1]).toMatchObject({ is_self: true, profile_notes: [] });
    expect(doc.plans[0]).toMatchObject({ tags: ["box tie"], photos: [] });
  });

  it("lists passkeys by name and dates only", () => {
    const doc = exportDocument({
      ...EMPTY,
      passkeys: [{ name: "Phone", created_at: "a", last_used_at: "b", public_key: "secret-ish" }],
    }, "2026-10-13T10:00:00Z");
    expect(doc.account.passkeys).toEqual([{ name: "Phone", created_at: "a", last_used_at: "b" }]);
  });
});

describe("exportFileName", () => {
  it("names the file after the day", () => {
    expect(exportFileName("2026-10-13T23:59:00Z")).toBe("notonawa-2026-10-13.json");
  });
});
