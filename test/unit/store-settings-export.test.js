// Format 2's settings record (records/settings.js) and export
// (store/queries/export.js): the same journal, kept as format 1's rows and
// as format 2's records, exports the same, so a file from either format
// imports into either.
import { describe, it, expect } from "vitest";
import { roleName, defaultShape, settingsChanged, SHAPE_RANGES } from "../../public/js/records/settings.js";
import { journalExport, photoFile } from "../../public/js/store/queries/export.js";
import { exportDocument, photoFile as serverPhotoFile } from "../../src/data/shape.js";
import { SHAPE_RANGES as SERVER_SHAPES } from "../../src/poses/parse.js";

const NOW = "2026-11-14T12:00:00Z";
const T1 = "2026-01-01T00:00:00Z";
const T2 = "2026-02-01T00:00:00Z";

describe("the settings record", () => {
  it("reads role names and the default body as the server does", () => {
    expect([roleName("  Rope   top ", "top"), roleName("TOP", "top"), roleName("", "bottom")]).toEqual(["Rope top", null, null]);
    expect(() => roleName("Spotter", "top")).toThrow(/already a role/);
    expect(() => roleName("x".repeat(25), "top")).toThrow(/24 characters/);
    expect(defaultShape([50, 50, 50, 170])).toEqual([50, 50, 50, 170]);
    expect(() => defaultShape([50, 50, 50, 140])).toThrow(/body shape/);
    expect(SHAPE_RANGES).toEqual(SERVER_SHAPES);
  });

  it("changes only what's sent, refuses two names alike, and drops ones back to the default", () => {
    const body = settingsChanged({ top_label: "Rigger", created_at: T1 }, { bottom_label: "Bunny", default_shape: [1, 2, 3, 160] }, NOW);
    expect(body).toEqual({ top_label: "Rigger", bottom_label: "Bunny", default_shape: [1, 2, 3, 160], created_at: T1, updated_at: NOW });
    expect(() => settingsChanged(body, { bottom_label: "rigger" }, NOW)).toThrow("Give the two roles different names.");
    expect(settingsChanged(body, { top_label: "", default_shape: null }, NOW)).toEqual({ bottom_label: "Bunny", created_at: T1, updated_at: NOW });
  });
});

describe("the export", () => {
  const aliases = JSON.stringify([{ platform: "fetlife", alias: "sam" }]);
  const shape = { v: 1, strokes: [{ c: "red", w: 2, p: [1, 1] }] };
  const pose = { v: 1, joints: {} };

  // Format 1: the rows src/data/db.js reads.
  const rows = {
    user: { created_at: T1, accepted_at: T1, terms_version: "1", recovery_email_set: 0, top_label: "Rigger", bottom_label: null,
      theme: "dark", seen_release: null, hide_welcome: 0, default_shape: "[50,50,50,170]" },
    passkeys: [],
    people: [
      { id: "me", name: "Me", pronouns: null, notes: null, is_self: 1, default_role: "top", is_educator: 0, based_in: null, aliases: null,
        about: "Hi", about_shared_on: null, connection_id: null, archived_at: null, created_at: T1, updated_at: T1 },
      { id: "sam", name: "Sam", pronouns: "they", notes: "Notes", is_self: 0, default_role: null, is_educator: 1, based_in: "Leeds",
        aliases, about: null, about_shared_on: "2026-01-02", connection_id: null, archived_at: T2, created_at: T2, updated_at: T2 },
    ],
    profileNotes: [{ person_id: "sam", type: "limit", description: "No neck", noted_on: "2026-01-03", is_current: 1, created_at: T2, updated_at: T2 }],
    locations: [{ id: "studio", name: "Studio", notes: null, maps_url: "https://maps.google.com/?q=1,2", city: "Leeds", state_province: null,
      country: "UK", latitude: 1, longitude: 2, is_default: 1, archived_at: null, created_at: T1, updated_at: T1 }],
    plans: [{ id: "tk", title: "TK", stage: "idea", plan_type: "harness", tie_type: null, description: "D", notes: null, album_url: null,
      est_difficulty: 3, variation_of: null, version: 1, archived_at: null, created_at: T1, updated_at: T1, workshop_id: "w1" }],
    planTags: [{ plan_id: "tk", name: "box" }],
    tags: [{ name: "Ankle" }, { name: "box" }],
    ties: [{ id: "t1", title: "Session", tie_date: "2026-01-05", tie_type: "floor", duration_minutes: 60, success_rating: 4, notes: "N",
      album_url: null, location_id: "studio", location_deleted: 0, created_at: T1, updated_at: T1, workshop_id: "w1" }],
    participants: [
      { tie_id: "t1", person_id: "sam", role: "bottom", difficulty_rating: 3, experience_rating: null, notes: null },
      { tie_id: "t1", person_id: null, role: "spotter", difficulty_rating: null, experience_rating: null, notes: null },
    ],
    tiePlans: [{ tie_id: "t1", plan_id: "tk", plan_version: 1 }],
    tieTags: [{ tie_id: "t1", name: "Ankle" }, { tie_id: "t1", name: "box" }],
    workshops: [{ id: "w1", title: "Intro", start_date: "2026-01-04", end_date: null, location_id: null, location_deleted: 1, attendee_count: 8,
      rating: 5, difficulty: null, rating_content: null, rating_teaching: null, rating_value: null, cost: "USD 10.00", event_url: null,
      description: null, notes: null, album_url: null, created_at: T1, updated_at: T1 }],
    workshopPeople: [{ workshop_id: "w1", person_id: "sam", kind: "educator", role: "top" }],
    workshopTags: [],
    media: [{ id: "f1", tie_id: "t1", kind: "photo", mime: "image/webp", caption: "Front", position: 0, created_at: T1 }],
    drawings: [{ id: "d1", tie_id: "t1", data: JSON.stringify(shape), caption: null, position: 1, created_at: T1, updated_at: T1 }],
    poses: [{ id: "q1", plan_id: "tk", data: JSON.stringify(pose), caption: "Kneel", position: 0, created_at: T1, updated_at: T1 }],
    notices: [], feedback: [], shares: [], connections: [],
    posePresets: [{ kind: "arms", name: "Box", data: JSON.stringify({ joints: {} }), created_at: T1, updated_at: T1 }],
  };

  // Format 2: the same journal as records.
  /** @param {string} kind @param {string} id @param {Record<string, any>} body */
  const e = (kind, id, body) => ({ kind, id, body });
  const records = {
    settings: [e("settings", "s", { top_label: "Rigger", default_shape: [50, 50, 50, 170] })],
    pose_preset: [e("pose_preset", "pp", { kind: "arms", name: "Box", data: { joints: {} }, created_at: T1, updated_at: T1 })],
    person: [
      e("person", "me", { name: "Me", is_self: true, default_role: "top", about: "Hi", created_at: T1, updated_at: T1 }),
      e("person", "sam", { name: "Sam", pronouns: "they", notes: "Notes", is_educator: true, based_in: "Leeds", aliases: JSON.parse(aliases),
        about_shared_on: "2026-01-02", archived_at: T2, created_at: T2, updated_at: T2,
        profile_notes: [{ id: "n1", type: "limit", description: "No neck", noted_on: "2026-01-03", is_current: true, created_at: T2, updated_at: T2 }] }),
    ],
    location: [e("location", "studio", { name: "Studio", maps_url: "https://maps.google.com/?q=1,2", city: "Leeds", country: "UK", latitude: 1,
      longitude: 2, is_default: true, created_at: T1, updated_at: T1 })],
    tag: [e("tag", "ta", { name: "Ankle" }), e("tag", "tb", { name: "box" })],
    plan: [e("plan", "tk", { title: "TK", stage: "idea", plan_type: "harness", description: "D", est_difficulty: 3, version: 1, created_at: T1,
      updated_at: T1, workshop_id: "w1", tags: ["tb"], visuals: [{ kind: "pose", id: "q1" }] })],
    pose: [e("pose", "q1", { data: pose, caption: "Kneel", created_at: T1, updated_at: T1 })],
    drawing: [e("drawing", "d1", { data: shape, created_at: T1, updated_at: T1 })],
    tie: [e("tie", "t1", { title: "Session", tie_date: "2026-01-05", tie_type: "floor", duration_minutes: 60, success_rating: 4, notes: "N",
      location_id: "studio", created_at: T1, updated_at: T1, workshop_id: "w1", tags: ["tb", "ta"],
      participants: [{ person_id: "sam", role: "bottom", difficulty_rating: 3 }, { person_id: null, role: "spotter" }],
      plans: [{ plan_id: "tk", plan_version: 1 }],
      visuals: [{ kind: "file", id: "f1", key: "k".repeat(43), file_kind: "photo", mime: "image/webp", caption: "Front", created_at: T1 },
        { kind: "drawing", id: "d1" }] })],
    workshop: [e("workshop", "w1", { title: "Intro", start_date: "2026-01-04", location_deleted: true, attendee_count: 8, rating: 5,
      cost: "USD 10.00", created_at: T1, updated_at: T1, people: [{ person_id: "sam", kind: "educator", role: "top" }] })],
  };

  it("is the same from format 2's records as from format 1's rows", () => {
    const v1 = exportDocument(/** @type {any} */ (rows), NOW);
    const v2 = journalExport(/** @type {any} */ (records));
    for (const part of /** @type {const} */ (["people", "locations", "plans", "tags", "ties", "workshops"])) {
      expect(v2[part], part).toEqual(v1[part]);
    }
    expect(v2.pose_presets).toEqual(v1.account.pose_presets);
    expect(v2.settings).toEqual({ top_label: v1.account.settings.top_label, bottom_label: v1.account.settings.bottom_label,
      default_shape: v1.account.settings.default_shape });
  });

  it("names photos' files as the server does", () => {
    for (const mime of ["image/webp", "video/mp4", "image/jpeg"]) expect(photoFile("x", mime)).toBe(serverPhotoFile("x", mime));
  });
});
