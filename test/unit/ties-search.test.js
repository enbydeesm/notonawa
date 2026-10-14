import { describe, it, expect } from "vitest";
import { parseTieFilters } from "../../src/ties/parse.js";
import { tieFilterSql, escapeLike } from "../../src/ties/search.js";

const parse = parseTieFilters;

const NO_FILTERS = { person_ids: [], location_ids: [], tag_ids: [], tag_match: "any", from: null, to: null, q: null, page: 1, page_size: 20, sort: "newest" };

describe("parseTieFilters", () => {
  it("has no filters and page 1 by default", () => {
    expect(parse({})).toEqual(NO_FILTERS);
    expect(parse({ person_ids: null, q: "  ", from: "", page: "" })).toEqual(NO_FILTERS);
  });

  it("reads every filter", () => {
    expect(parse({
      person_ids: ["a", "b"], location_ids: ["c"], tag_ids: ["t"], tag_match: "all",
      from: "2026-01-01", to: "2026-02-01", q: " harness ", page: 3, page_size: "50", sort: "oldest",
    })).toEqual({
      person_ids: ["a", "b"], location_ids: ["c"], tag_ids: ["t"], tag_match: "all",
      from: "2026-01-01", to: "2026-02-01", q: "harness", page: 3, page_size: 50, sort: "oldest",
    });
  });

  it("drops duplicate and empty ids", () => {
    expect(parse({ person_ids: ["a", "a", "", null] }).person_ids).toEqual(["a"]);
    expect(parse({ location_ids: ["x", "x"] }).location_ids).toEqual(["x"]);
  });

  it("matches any tag unless told all, and rejects anything else", () => {
    expect(parse({ tag_ids: ["t"] }).tag_match).toBe("any");
    expect(parse({ tag_match: "" }).tag_match).toBe("any");
    expect(parse({ tag_match: "all" }).tag_match).toBe("all");
    expect(() => parse({ tag_match: "some" })).toThrow("Match any or all of the tags.");
    expect(() => parse({ tag_ids: "t" })).toThrow("Choose tags as a list.");
  });

  it("shows 20, 50 or 100 a page, newest or oldest first", () => {
    expect(parse({ page_size: 100 }).page_size).toBe(100);
    for (const page_size of [10, 21, "lots", 1000]) {
      expect(() => parse({ page_size })).toThrow("Show 20, 50, 100 ties per page.");
    }
    expect(parse({ sort: "" }).sort).toBe("newest");
    expect(() => parse({ sort: "random" })).toThrow("Sort by newest or oldest.");
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
      person_ids: ["p1", "p2"], location_ids: ["'; DROP TABLE ties; --"], tag_ids: ["t1"], tag_match: "all",
      from: "2026-01-01", to: "2026-02-01", q: "50%_off", page: 1, page_size: 20, sort: "newest",
    };
    const { where, params } = tieFilterSql("me", filters);
    expect(params).toEqual([
      "me",
      '["p1","p2"]', 2,
      `["'; DROP TABLE ties; --"]`,
      '["t1"]', 1,
      "2026-01-01", "2026-02-01",
      "%50\\%\\_off%", "%50\\%\\_off%", "%50\\%\\_off%",
    ]);
    expect(where).not.toContain("DROP");
    expect(where).not.toContain("p1");
    expect(where).not.toContain("t1");
    expect(where.match(/\?/g)).toHaveLength(params.length);
  });

  it("matches all chosen people by counting them", () => {
    const { where, params } = tieFilterSql("me", { ...NO_FILTERS, person_ids: ["a", "b", "c"] });
    expect(where).toContain("COUNT(DISTINCT tp.person_id)");
    expect(params.slice(1)).toEqual(['["a","b","c"]', 3]);
  });

  it("matches any chosen tag, or all of them by counting", () => {
    const any = tieFilterSql("me", { ...NO_FILTERS, tag_ids: ["x", "y"] });
    expect(any.where).toContain("EXISTS (SELECT 1 FROM tie_tags tt");
    expect(any.params.slice(1)).toEqual(['["x","y"]']);
    const all = tieFilterSql("me", { ...NO_FILTERS, tag_ids: ["x", "y"], tag_match: "all" });
    expect(all.where).toContain("COUNT(DISTINCT tt.tag_id)");
    expect(all.params.slice(1)).toEqual(['["x","y"]', 2]);
    // "all" with no tags chosen filters nothing.
    expect(tieFilterSql("me", { ...NO_FILTERS, tag_match: "all" }).params).toEqual(["me"]);
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
