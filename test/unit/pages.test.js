// Pure helpers used by the pages (public/js). No DOM needed.
import { describe, it, expect } from "vitest";
import { formatDate, capitalise } from "../../public/js/format.js";
import { tieMeta, participantLabel, planLabel, nextRating, ROLES, TIE_TYPES } from "../../public/js/ties-view.js";
import { TIE_TYPES as API_TIE_TYPES, ROLES as API_ROLES } from "../../src/ties/parse.js";

describe("formatDate", () => {
  it("formats a plain date without shifting it by time zone", () => {
    expect(formatDate("2026-10-12", "en-US")).toBe("Oct 12, 2026");
    expect(formatDate("2026-01-01", "en-US")).toBe("Jan 1, 2026");
  });
  it("says when there's no date", () => {
    expect(formatDate(null)).toBe("No date");
  });
});

describe("capitalise", () => {
  it("capitalises the first letter", () => {
    expect(capitalise("rigger")).toBe("Rigger");
  });
});

describe("tieMeta", () => {
  const base = { tie_date: "2026-10-12", tie_type: null, location_name: null, location_deleted: 0, duration_minutes: null, success_rating: null };

  it("lists date, type, location, duration and rating in order", () => {
    expect(tieMeta({ ...base, tie_type: "partial suspension", location_name: "Studio", duration_minutes: 45, success_rating: 4 }, "en-US")).toEqual([
      { text: "Oct 12, 2026", deleted: false },
      { text: "Partial suspension", deleted: false },
      { text: "Studio", deleted: false },
      { text: "45 min", deleted: false },
      { text: "4/5", deleted: false, rating: 4 },
    ]);
  });

  it("marks a deleted location", () => {
    expect(tieMeta({ ...base, location_deleted: 1 }, "en-US")).toContainEqual({ text: "(location deleted)", deleted: true });
  });

  it("leaves out what wasn't recorded, including a duration of zero only when missing", () => {
    expect(tieMeta(base, "en-US")).toHaveLength(1);
    expect(tieMeta({ ...base, duration_minutes: 0 }, "en-US")).toContainEqual({ text: "0 min", deleted: false });
  });
});

describe("the pages' lists", () => {
  it("match the API's", () => {
    expect(TIE_TYPES).toEqual(API_TIE_TYPES);
    expect(ROLES).toEqual(API_ROLES);
  });
});

describe("nextRating", () => {
  it("fills up to the tapped hank, and tapping the chosen one clears it", () => {
    expect(nextRating(null, 3)).toBe(3);
    expect(nextRating(3, 2)).toBe(2);
    expect(nextRating(2, 5)).toBe(5);
    expect(nextRating(3, 3)).toBeNull();
  });
});

describe("participantLabel and planLabel", () => {
  it("show names, or a deleted label", () => {
    expect(participantLabel({ person_name: "Sam", role: "model" })).toEqual({ name: { text: "Sam", deleted: false }, role: "model" });
    expect(participantLabel({ person_name: null, role: "model" }).name).toEqual({ text: "(person deleted)", deleted: true });
    expect(planLabel({ plan_title: "Hip harness", plan_version: 2 })).toEqual({ text: "Hip harness (v2)", deleted: false });
    expect(planLabel({ plan_title: null, plan_version: 1 })).toEqual({ text: "(plan deleted)", deleted: true });
  });
});
