// What each kind of record holds (public/js/records/schema.js): the checks
// on one record on its own, kept in step with the server's parsers, which
// stop seeing these fields once records are sealed.
import { describe, it, expect } from "vitest";
import {
  FIELDS, recordProblems, checkRecord, BadRecord, ROLES, WORKSHOP_ROLES, TIE_TYPES, PLAN_TYPES, PLAN_STAGES, LIMITS,
} from "../../public/js/records/schema.js";
import { RECORD_KINDS } from "../../public/js/crypto/records.js";
import * as ties from "../../src/ties/parse.js";
import { PLAN_TYPES as SERVER_PLAN_TYPES, PLAN_STAGES as SERVER_PLAN_STAGES } from "../../src/resources/config.js";
import { MAX_TAGS, MAX_TAG_LENGTH } from "../../src/tags/parse.js";
import { MAX_ROLE_NAME } from "../../src/account/settings.js";
import { MAX_ATTENDEES, PEOPLE_KINDS } from "../../src/workshops/parse.js";
import { PLATFORMS } from "../../public/js/aliases.js";

const KEY = "A".repeat(43);
const TIE = { tie_date: "2026-11-13", tie_type: "floor" };

describe("kept in step with the server's rules", () => {
  it("has the same roles, types, stages and limits", () => {
    expect(ROLES).toEqual(ties.ROLES);
    expect(WORKSHOP_ROLES).toEqual(ties.WORKSHOP_ROLES);
    expect(TIE_TYPES).toEqual(ties.TIE_TYPES);
    expect(PLAN_TYPES).toEqual(SERVER_PLAN_TYPES);
    expect(PLAN_STAGES).toEqual(SERVER_PLAN_STAGES);
    expect([LIMITS.tags, LIMITS.tagName, LIMITS.roleName, LIMITS.attendees]).toEqual([MAX_TAGS, MAX_TAG_LENGTH, MAX_ROLE_NAME, MAX_ATTENDEES]);
    expect(PEOPLE_KINDS).toEqual(["educator", "participant"]);
  });

  it("knows every alias platform", () => {
    expect(recordProblems("person", { name: "A", aliases: PLATFORMS.map((p) => ({ platform: p.value, alias: "x" })) })).toEqual([]);
  });

  it("has fields for every kind", () => {
    expect(Object.keys(FIELDS).sort()).toEqual([...RECORD_KINDS].sort());
  });
});

describe("a tie", () => {
  it("needs a date and a type", () => {
    expect(recordProblems("tie", TIE)).toEqual([]);
    expect(recordProblems("tie", { tie_type: "floor" })).toEqual(["tie_date is needed"]);
    expect(recordProblems("tie", { tie_date: "2026-11-13" })).toEqual(["tie_type is needed"]);
    expect(recordProblems("tie", { ...TIE, tie_type: "rope" })[0]).toMatch(/tie_type should be one of/);
    expect(recordProblems("tie", { ...TIE, tie_date: "2026-13-45" })).toEqual(["tie_date should be a date"]);
  });

  it("keeps ratings, durations and lists within today's limits", () => {
    expect(recordProblems("tie", { ...TIE, success_rating: 6 })[0]).toMatch(/success_rating/);
    expect(recordProblems("tie", { ...TIE, duration_minutes: 1441 })[0]).toMatch(/duration_minutes/);
    expect(recordProblems("tie", { ...TIE, tags: Array.from({ length: 31 }, (_, i) => `t${i}`) })).toEqual(["tags has more than 30"]);
    expect(recordProblems("tie", { ...TIE, participants: [{ person_id: "p1", role: "rigger" }] })[0]).toMatch(/role should be one of/);
  });

  it("can link a deleted person, but not a deleted location with its id", () => {
    expect(recordProblems("tie", { ...TIE, participants: [{ person_id: null, role: "top" }] })).toEqual([]);
    expect(recordProblems("tie", { ...TIE, location_deleted: true })).toEqual([]);
    expect(recordProblems("tie", { ...TIE, location_deleted: true, location_id: "l1" })).toEqual(["location_deleted with a location_id"]);
  });

  it("only links web addresses", () => {
    expect(recordProblems("tie", { ...TIE, album_url: "https://example.com/a" })).toEqual([]);
    expect(recordProblems("tie", { ...TIE, album_url: "javascript:alert(1)" })).toEqual(["album_url should be a web link"]);
  });

  it("lists its visuals once each, a file with its key, and a cover among them", () => {
    const visuals = [
      { kind: "file", id: "f1", key: KEY, file_kind: "photo", caption: "Hi" }, { kind: "drawing", id: "d1" }, { kind: "pose", id: "p1" },
    ];
    expect(recordProblems("tie", { ...TIE, visuals, cover: "d1" })).toEqual([]);
    expect(recordProblems("tie", { ...TIE, visuals, cover: "x" })).toEqual(["the cover isn't one of its visuals"]);
    expect(recordProblems("tie", { ...TIE, visuals: [...visuals, visuals[1]] })).toEqual(["a visual is listed twice"]);
    expect(recordProblems("tie", { ...TIE, visuals: [{ kind: "file", id: "f1", file_kind: "photo" }] })[0]).toMatch(/key is needed/);
    expect(recordProblems("tie", { ...TIE, visuals: [{ kind: "file", id: "f1", key: KEY, file_kind: "photo", caption: "x".repeat(1001) }] })[0])
      .toMatch(/caption is longer/);
  });

  it("keeps fields it doesn't know", () => {
    expect(recordProblems("tie", { ...TIE, from_a_newer_version: 1 })).toEqual([]);
  });
});

describe("other kinds", () => {
  it("need their names and titles", () => {
    expect(recordProblems("plan", {})).toEqual(["title is needed"]);
    expect(recordProblems("person", {})).toEqual(["name is needed"]);
    expect(recordProblems("location", {})).toEqual(["name is needed"]);
    expect(recordProblems("tag", { name: "x".repeat(41) })).toEqual(["name is longer than 40 characters"]);
    expect(recordProblems("workshop", { title: "W" })).toEqual(["start_date is needed"]);
  });

  it("refuse a plan that's a variation of itself", () => {
    expect(recordProblems("plan", { title: "P", variation_of: "p1" }, { id: "p1" })).toEqual(["a plan can't be a variation of itself"]);
    expect(recordProblems("plan", { title: "P", variation_of: "p2" }, { id: "p1" })).toEqual([]);
  });

  it("refuse a workshop ending before it starts, or with someone on it twice", () => {
    expect(recordProblems("workshop", { title: "W", start_date: "2026-11-13", end_date: "2026-11-12" })).toEqual(["end_date is before start_date"]);
    expect(recordProblems("workshop", {
      title: "W", start_date: "2026-11-13", people: [{ person_id: "a", kind: "educator" }, { person_id: "a", kind: "participant", role: "audit" }],
    })).toEqual(["someone is on the workshop twice"]);
  });

  it("refuse two role names alike", () => {
    expect(recordProblems("settings", { top_label: "Rigger", bottom_label: "rigger" })).toEqual(["the two role names are the same"]);
    expect(recordProblems("settings", { top_label: "x".repeat(25) })[0]).toMatch(/top_label/);
  });

  it("keep coordinates on the map", () => {
    expect(recordProblems("location", { name: "L", latitude: 91 })[0]).toMatch(/latitude/);
    expect(recordProblems("location", { name: "L", latitude: 45.5, longitude: -122.6 })).toEqual([]);
  });

  it("hold a drawing's or pose's data in its own format", () => {
    expect(recordProblems("drawing", { data: { v: 1, strokes: [] } })).toEqual([]);
    expect(recordProblems("drawing", { data: { strokes: [] } })).toEqual(["data isn't in a known format"]);
    expect(recordProblems("pose_preset", { kind: "legs", data: {} })[0]).toMatch(/kind should be one of/);
  });
});

describe("checkRecord", () => {
  it("throws BadRecord with every problem, the first in its message", () => {
    expect(() => checkRecord("tie", {})).toThrow(BadRecord);
    try {
      checkRecord("tie", {});
    } catch (err) {
      expect(/** @type {BadRecord} */ (err).problems).toEqual(["tie_date is needed", "tie_type is needed"]);
      expect(/** @type {Error} */ (err).message).toBe("This entry couldn't be saved: tie_date is needed.");
    }
    expect(() => checkRecord("tie", TIE)).not.toThrow();
  });

  it("refuses an unknown kind or something that isn't a record", () => {
    expect(recordProblems(/** @type {any} */ ("ties"), {})).toEqual(["not a kind of record: ties"]);
    expect(recordProblems("tie", [])).toEqual(["a record should be an object"]);
  });
});

describe("the settings record (found converting)", () => {
  it("keeps the default body as the poser's four sliders", () => {
    expect(recordProblems("settings", { top_label: "Rigger", default_shape: [50, 50, 50, 170] })).toEqual([]);
    expect(recordProblems("settings", { default_shape: { gender: 50 } })).toEqual(["default_shape should be a list"]);
    expect(recordProblems("settings", { default_shape: [1, 2, 3, 4, 5] })).toEqual(["default_shape has more than 4"]);
  });
});
