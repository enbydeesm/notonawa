import { describe, it, expect } from "vitest";
import { parseStatsFilters, ROLE_GROUPS } from "../../src/stats/parse.js";
import { tieFilterSql } from "../../src/ties/search.js";
import { assembleStatsTies } from "../../src/stats/db.js";

describe("parseStatsFilters", () => {
  it("has no filters by default, and matches any person and any tag", () => {
    const filters = parseStatsFilters({});
    expect(filters).toMatchObject({
      person_ids: [], location_ids: [], tag_ids: [], from: null, to: null,
      person_match: "any", tag_match: "any", self_roles: null,
    });
  });

  it("reads the dates and the ids", () => {
    expect(parseStatsFilters({
      from: "2026-01-01", to: "2026-12-31", person_ids: ["a", "a"], location_ids: ["l"], tag_ids: ["t"],
    })).toMatchObject({ from: "2026-01-01", to: "2026-12-31", person_ids: ["a"], location_ids: ["l"], tag_ids: ["t"] });
  });

  it("turns a role into the roles it covers", () => {
    expect(parseStatsFilters({ role: "all" }).self_roles).toBeNull();
    expect(parseStatsFilters({ role: "" }).self_roles).toBeNull();
    expect(parseStatsFilters({ role: "top" }).self_roles).toEqual(["top"]);
    expect(parseStatsFilters({ role: "bottom" }).self_roles).toEqual(["bottom"]);
    expect(parseStatsFilters({ role: "self_tie" }).self_roles).toEqual(["self tie"]);
    expect(parseStatsFilters({ role: "spotter" }).self_roles).toEqual(["spotter"]);
    expect(Object.keys(ROLE_GROUPS)).toEqual(["top", "bottom", "self_tie", "spotter", "photographer"]);
  });

  it("refuses a role it doesn't know, a backwards range, and a page or keyword it ignores", () => {
    expect(() => parseStatsFilters({ role: "rigger" })).toThrow("Choose a role");
    expect(() => parseStatsFilters({ role: "toString" })).toThrow("Choose a role");
    expect(() => parseStatsFilters({ from: "2026-02-01", to: "2026-01-01" })).toThrow("The start date is after the end date.");
    expect(() => parseStatsFilters({ person_ids: "a" })).toThrow("Choose people as a list.");
  });
});

describe("tieFilterSql with person_match", () => {
  it("finds ties with any of the people when person_match is any", () => {
    const { where, params } = tieFilterSql("me", { ...parseStatsFilters({ person_ids: ["a", "b"] }) });
    expect(where).toContain("EXISTS (SELECT 1 FROM tie_participants tp");
    expect(where).not.toContain("COUNT(DISTINCT tp.person_id)");
    expect(params).toEqual(["me", '["a","b"]']);
  });
});

describe("assembleStatsTies", () => {
  it("nests participants under their ties, with is_self as true or false", () => {
    const ties = assembleStatsTies(
      [{ id: "t1", tie_date: "2026-01-01" }, { id: "t2", tie_date: "2026-01-02" }],
      [
        { tie_id: "t1", person_id: "me", person_name: "Me", is_self: 1, role: "rigger" },
        { tie_id: "t1", person_id: "p", person_name: "Sam", is_self: 0, role: "model" },
        { tie_id: "gone", person_id: "x", person_name: "X", is_self: 0, role: "model" },
      ]
    );
    expect(ties).toEqual([
      { id: "t1", tie_date: "2026-01-01", participants: [
        { person_id: "me", person_name: "Me", is_self: true, role: "rigger" },
        { person_id: "p", person_name: "Sam", is_self: false, role: "model" },
      ] },
      { id: "t2", tie_date: "2026-01-02", participants: [] },
    ]);
  });
});
