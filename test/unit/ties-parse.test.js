import { describe, it, expect } from "vitest";
import { parseTieInput, parseParticipants, parsePlanIds } from "../../src/ties/parse.js";

describe("parseTieInput", () => {
  it("parses a full tie", () => {
    expect(parseTieInput({
      title: " Floor session ",
      tie_date: "2026-10-12",
      duration_minutes: "45",
      success_rating: "4",
      notes: "",
      location_id: "loc1",
      participants: [{ person_id: "p1", role: "rigger" }],
      plan_ids: ["pl1"],
    })).toEqual({
      title: "Floor session",
      tie_date: "2026-10-12",
      duration_minutes: 45,
      success_rating: 4,
      notes: null,
      location_id: "loc1",
      participants: [{ person_id: "p1", role: "rigger" }],
      plan_ids: ["pl1"],
    });
  });

  it("needs at least a title or a date", () => {
    expect(() => parseTieInput({})).toThrow("Add at least a title or a date.");
    expect(parseTieInput({ tie_date: "2026-10-12" }).title).toBeNull();
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
    expect(() => parseParticipants([{ role: "model" }])).toThrow("needs a person and a role");
    expect(() => parseParticipants([{ person_id: "p1", role: "chef" }])).toThrow("Expected one of");
  });

  it("keeps one of the same person in the same role, but allows different roles", () => {
    expect(parseParticipants([
      { person_id: "p1", role: "model" },
      { person_id: "p1", role: "model" },
      { person_id: "p1", role: "photographer" },
    ])).toEqual([
      { person_id: "p1", role: "model" },
      { person_id: "p1", role: "photographer" },
    ]);
  });

  it("rejects non-lists and more than 20 people", () => {
    expect(() => parseParticipants("p1")).toThrow("up to 20");
    expect(() => parseParticipants(Array(21).fill({ person_id: "p", role: "model" }))).toThrow("up to 20");
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
