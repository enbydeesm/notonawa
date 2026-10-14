// Pure helpers used by the pages (public/js). No DOM needed.
import { describe, it, expect } from "vitest";
import { formatDate, capitalise } from "../../public/js/format.js";
import { placeLine, showingText, peopleThatFit, participantLabel, planLabel, nextRating, ROLES, TIE_TYPES } from "../../public/js/ties-view.js";
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

describe("placeLine", () => {
  const base = { tie_type: null, location_name: null, location_deleted: 0 };
  /** @param {Record<string, any>} tie */
  const text = (tie) => placeLine(tie).map((part) => part.text).join(" ");

  it("says the type at the location, keeping 'at' when there's no type", () => {
    expect(text({ ...base, tie_type: "partial suspension", location_name: "Studio" })).toBe("Partial suspension at Studio");
    expect(text({ ...base, location_name: "Studio" })).toBe("at Studio");
    expect(text({ ...base, tie_type: "floor" })).toBe("Floor");
    expect(placeLine(base)).toEqual([]);
  });

  it("marks a deleted location", () => {
    expect(placeLine({ ...base, tie_type: "floor", location_deleted: 1 })).toEqual([
      { text: "Floor", deleted: false }, { text: "at", deleted: false }, { text: "(location deleted)", deleted: true },
    ]);
  });
});

describe("showingText", () => {
  it("says how many match out of all my ties", () => {
    expect(showingText(3, 40)).toBe("Showing 3 of 40 ties");
    expect(showingText(0, 0)).toBe("Showing 0 of 0 ties");
    expect(showingText(1, 1)).toBe("Showing 1 of 1 tie");
  });
});

describe("peopleThatFit", () => {
  const more = () => 20;
  it("shows everyone who fits, with no '+n' when nobody's hidden", () => {
    expect(peopleThatFit([50, 50, 50], 150, more)).toBe(3);
    expect(peopleThatFit([], 100, more)).toBe(0);
  });
  it("leaves room for the '+n' when some don't fit", () => {
    // 50 + 50 = 100 fits, but 100 + "+1" (20) doesn't, so only one shows.
    expect(peopleThatFit([50, 50, 50], 110, more)).toBe(1);
    expect(peopleThatFit([50, 50, 50], 120, more)).toBe(2);
  });
  it("can show nobody but the '+n'", () => {
    expect(peopleThatFit([200, 50], 100, more)).toBe(0);
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
