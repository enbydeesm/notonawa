import { describe, it, expect } from "vitest";
import { parseWorkshopInput, parseWorkshopUpdate } from "../../src/workshops/parse.js";
import { BadInput } from "../../src/http.js";
import { sealed } from "../sealed.js";

const BASE = { title: " Intro to floor ", start_date: "2026-03-01" };

describe("parseWorkshopInput", () => {
  it("reads a whole workshop, educators and participants as one list", () => {
    expect(parseWorkshopInput({
      ...BASE, end_date: "2026-03-02", location_id: "loc", attendee_count: "12", rating: 4,
      description: sealed("what"), notes: sealed("notes"), album_url: sealed("album"),
      educators: [{ person_id: "a", role: "top" }], participants: [{ person_id: "b", role: "model" }],
      tags: ["Floor", "floor", " kata "],
    })).toEqual({
      title: "Intro to floor", start_date: "2026-03-01", end_date: "2026-03-02", location_id: "loc",
      attendee_count: 12, rating: 4, description: sealed("what"), notes: sealed("notes"), album_url: sealed("album"),
      // "model" is read as bottom, as on ties.
      people: [{ person_id: "a", kind: "educator", role: "top" }, { person_id: "b", kind: "participant", role: "bottom" }],
      tags: ["Floor", "kata"],
    });
  });

  it("takes audit as a role, which ties don't", () => {
    expect(parseWorkshopInput({
      ...BASE, educators: [{ person_id: "a", role: "audit" }], participants: [{ person_id: "b", role: "audit" }],
    }).people).toEqual([{ person_id: "a", kind: "educator", role: "audit" }, { person_id: "b", kind: "participant", role: "audit" }]);
    expect(() => parseWorkshopInput({ ...BASE, participants: [{ person_id: "b", role: "auditor" }] })).toThrow("Expected one of");
  });

  it("needs a title and a start date, and an end date not before it", () => {
    expect(() => parseWorkshopInput({ start_date: "2026-03-01" })).toThrow("Add a title.");
    expect(() => parseWorkshopInput({ title: "x" })).toThrow("Add a start date.");
    expect(() => parseWorkshopInput({ ...BASE, end_date: "2026-02-28" })).toThrow("before the start date");
    // The same day: a one-day workshop, so no end date.
    expect(parseWorkshopInput({ ...BASE, end_date: "2026-03-01" }).end_date).toBeNull();
  });

  it("refuses a negative attendee count, a bad rating and plain notes", () => {
    expect(() => parseWorkshopInput({ ...BASE, attendee_count: -1 })).toThrow("attendee count");
    expect(() => parseWorkshopInput({ ...BASE, attendee_count: 2.5 })).toThrow("attendee count");
    expect(parseWorkshopInput({ ...BASE, attendee_count: 0 }).attendee_count).toBe(0);
    expect(() => parseWorkshopInput({ ...BASE, rating: 6 })).toThrow(BadInput);
    expect(() => parseWorkshopInput({ ...BASE, notes: "plain" })).toThrow("weren't encrypted");
  });

  it("puts each person on once: an educator or a participant, never both", () => {
    expect(() => parseWorkshopInput({
      ...BASE, educators: [{ person_id: "a", role: "top" }], participants: [{ person_id: "a", role: "bottom" }],
    })).toThrow("not both");
    expect(() => parseWorkshopInput({ ...BASE, educators: [{ person_id: "a", role: "top" }, { person_id: "a", role: "bottom" }] }))
      .toThrow("twice");
    expect(() => parseWorkshopInput({ ...BASE, educators: [{ person_id: "a" }] })).toThrow("Each educator needs a person and a role.");
    expect(() => parseWorkshopInput({ ...BASE, participants: "a" })).toThrow("should be a list");
  });
});

describe("parseWorkshopUpdate", () => {
  it("reads which deleted people and location to keep", () => {
    expect(parseWorkshopUpdate({ ...BASE, keep_deleted: { people: ["x", "x", ""], location: true } }).keep_deleted)
      .toEqual({ people: ["x"], location: true });
    expect(parseWorkshopUpdate(BASE).keep_deleted).toEqual({ people: [], location: false });
    expect(() => parseWorkshopUpdate({ ...BASE, keep_deleted: [] })).toThrow(BadInput);
  });
});
