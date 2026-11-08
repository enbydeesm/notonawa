import { describe, it, expect } from "vitest";
import { parseTieInput, parseParticipants, parsePlanIds } from "../../src/ties/parse.js";

describe("parseTieInput", () => {
  it("parses a full tie", () => {
    expect(parseTieInput({
      title: " Floor session ",
      tie_date: "2026-10-12",
      tie_type: "partial suspension",
      duration_minutes: "45",
      success_rating: "4",
      notes: "",
      album_url: "",
      location_id: "loc1",
      participants: [{ person_id: "p1", role: "top" }],
      plan_ids: ["pl1"],
      tags: ["Futomomo"],
    })).toEqual({
      title: "Floor session",
      tie_date: "2026-10-12",
      tie_type: "partial suspension",
      duration_minutes: 45,
      success_rating: 4,
      notes: null,
      album_url: null,
      location_id: "loc1",
      participants: [{ person_id: "p1", role: "top" }],
      plan_ids: ["pl1"],
      tags: ["Futomomo"],
    });
  });

  it("needs a date and a type, but not a title", () => {
    expect(() => parseTieInput({})).toThrow("Add a date.");
    expect(() => parseTieInput({ title: "x", tie_date: "", tie_type: "floor" })).toThrow("Add a date.");
    expect(parseTieInput({ tie_date: "2026-10-12", tie_type: "floor" }).title).toBeNull();
  });

  it("only accepts a real YYYY-MM-DD tie date", () => {
    expect(parseTieInput({ title: "x", tie_date: " 2024-02-29 ", tie_type: "floor" }).tie_date).toBe("2024-02-29");
    for (const bad of ["2026-02-30", "12/10/2026", "yesterday", "2026-10-12T21:00:00Z"]) {
      expect(() => parseTieInput({ title: "x", tie_date: bad })).toThrow("Expected a date like 2026-10-12.");
    }
  });

  it("only accepts a known type, and needs one (migration 0014)", () => {
    const dated = { title: "x", tie_date: "2026-01-01" };
    expect(() => parseTieInput(dated)).toThrow("Choose a tie type: suspension, partial suspension, floor or hashira.");
    expect(() => parseTieInput({ ...dated, tie_type: "" })).toThrow("Choose a tie type");
    expect(parseTieInput({ ...dated, tie_type: "floor" }).tie_type).toBe("floor");
    expect(parseTieInput({ ...dated, tie_type: "hashira" }).tie_type).toBe("hashira");
    expect(() => parseTieInput({ title: "x", tie_type: "hanging" })).toThrow("Expected one of: suspension, partial suspension, floor, hashira.");
  });

  it("rejects ratings and durations out of range", () => {
    expect(() => parseTieInput({ title: "x", success_rating: 6 })).toThrow("1 to 5");
    expect(() => parseTieInput({ title: "x", duration_minutes: 2000 })).toThrow("0 to 1440");
  });
});

describe("parseParticipants", () => {
  it("defaults to none", () => {
    expect(parseParticipants(undefined)).toEqual([]);
  });

  it("needs a person and a known role for each", () => {
    expect(() => parseParticipants([{ person_id: "p1" }])).toThrow("needs a person and a role");
    expect(() => parseParticipants([{ role: "bottom" }])).toThrow("needs a person and a role");
    expect(() => parseParticipants([{ person_id: "p1", role: "chef" }])).toThrow("Expected one of");
    // Audit is a workshop's only.
    expect(() => parseParticipants([{ person_id: "p1", role: "audit" }])).toThrow("Expected one of");
  });

  it("keeps one of the same person in the same role, but allows different roles", () => {
    expect(parseParticipants([
      { person_id: "p1", role: "bottom" },
      { person_id: "p1", role: "bottom" },
      { person_id: "p1", role: "photographer" },
    ])).toEqual([
      { person_id: "p1", role: "bottom" },
      { person_id: "p1", role: "photographer" },
    ]);
  });

  it("reads rigger and model (from before migration 0013) as top and bottom, and takes self tie", () => {
    expect(parseParticipants([
      { person_id: "p1", role: "rigger" },
      { person_id: "p1", role: "top" },
      { person_id: "p2", role: "model" },
      { person_id: "p3", role: "self tie" },
    ])).toEqual([
      { person_id: "p1", role: "top" },
      { person_id: "p2", role: "bottom" },
      { person_id: "p3", role: "self tie" },
    ]);
  });

  it("rejects non-lists and more than 20 people", () => {
    expect(() => parseParticipants("p1")).toThrow("up to 20");
    expect(() => parseParticipants(Array(21).fill({ person_id: "p", role: "bottom" }))).toThrow("up to 20");
  });
});

describe("parsePlanIds", () => {
  it("removes blanks and duplicates", () => {
    expect(parsePlanIds(["a", "", "a", " b "])).toEqual(["a", "b"]);
  });
  it("rejects non-lists", () => {
    expect(() => parsePlanIds("a")).toThrow("up to 20");
  });
});
