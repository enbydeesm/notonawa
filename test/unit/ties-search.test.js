import { describe, it, expect } from "vitest";
import { parseTieFilters } from "../../src/ties/parse.js";
import { tieFilterSql, escapeLike } from "../../src/ties/search.js";

const parse = parseTieFilters;

const NO_FILTERS = { person_ids: [], location_ids: [], from: null, to: null, q: null, page: 1 };

describe("parseTieFilters", () => {
  it("has no filters and page 1 by default", () => {
    expect(parse({})).toEqual(NO_FILTERS);
    expect(parse({ person_ids: null, q: "  ", from: "", page: "" })).toEqual(NO_FILTERS);
  });

  it("reads every filter", () => {
    expect(parse({
      person_ids: ["a", "b"], location_ids: ["c"], from: "2026-01-01", to: "2026-02-01", q: " harness ", page: 3,
    })).toEqual({
      person_ids: ["a", "b"], location_ids: ["c"], from: "2026-01-01", to: "2026-02-01", q: "harness", page: 3,
    });
  });

  it("drops duplicate and empty ids", () => {
    expect(parse({ person_ids: ["a", "a", "", null] }).person_ids).toEqual(["a"]);
    expect(parse({ location_ids: ["x", "x"] }).location_ids).toEqual(["x"]);
  });

  it("rejects ids that aren't a list", () => {
    expect(() => parse({ person_ids: "a" })).toThrow("Choose people as a list.");
    expect(() => parse({ location_ids: { id: "x" } })).toThrow("Choose locations as a list.");
  });

  it("allows a one-day range but not a backwards one", () => {
    expect(parse({ from: "2026-01-01", to: "2026-01-01" }).to).toBe("2026-01-01");
    expect(() => parse({ from: "2026-01-02", to: "2026-01-01" })).toThrow("The start date is after the end date.");
  });

  it("rejects bad dates, pages, long searches and too many ids", () => {
    expect(() => parse({ to: "yesterday" })).toThrow("Expected a date like 2026-10-12.");
    for (const page of [0, -1, 1.5, "two"]) {
      expect(() => parse({ page })).toThrow("Page should be a whole number, 1 or more.");
    }
    expect(() => parse({ q: "x".repeat(201) })).toThrow("Search for 200 characters or fewer.");
    expect(parse({ q: "x".repeat(200) }).q).toHaveLength(200);
    const many = Array.from({ length: 51 }, (_, i) => `p${i}`);
    expect(() => parse({ person_ids: many })).toThrow("Choose up to 50 people.");
  });
});

describe("tieFilterSql", () => {
  it("always scopes to the owner", () => {
    expect(tieFilterSql("me", NO_FILTERS)).toEqual({ where: "t.owner_id = ?", params: ["me"] });
  });

  it("binds every value instead of putting it in the SQL", () => {
    const filters = {
      person_ids: ["p1", "p2"], location_ids: ["'; DROP TABLE ties; --"],
      from: "2026-01-01", to: "2026-02-01", q: "50%_off", page: 1,
    };
    const { where, params } = tieFilterSql("me", filters);
    expect(params).toEqual([
      "me",
      '["p1","p2"]', 2,
      `["'; DROP TABLE ties; --"]`,
      "2026-01-01", "2026-02-01",
      "%50\\%\\_off%", "%50\\%\\_off%", "%50\\%\\_off%",
    ]);
    expect(where).not.toContain("DROP");
    expect(where).not.toContain("p1");
    expect(where.match(/\?/g)).toHaveLength(params.length);
  });

  it("matches all chosen people by counting them", () => {
    const { where, params } = tieFilterSql("me", { ...NO_FILTERS, person_ids: ["a", "b", "c"] });
    expect(where).toContain("COUNT(DISTINCT tp.person_id)");
    expect(params.slice(1)).toEqual(['["a","b","c"]', 3]);
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards and the escape character itself", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
    expect(escapeLike("plain")).toBe("plain");
  });
});
