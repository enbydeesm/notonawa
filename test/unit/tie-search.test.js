// The Ties page's search state (public/js/tie-search.js). No DOM needed.
import { describe, it, expect } from "vitest";
import {
  readSearch, pageQuery, searchBody, hasKeywordInUrl, hasFilters, pageList, sortByName, nameMatches,
} from "../../public/js/tie-search.js";

/** @type {import("../../public/js/tie-search.js").SearchState} */
const EMPTY = { person_ids: [], location_ids: [], tag_ids: [], tag_match: "any", from: "", to: "", q: "", page: 1, page_size: 20, sort: "newest" };

describe("readSearch and pageQuery", () => {
  it("start empty on page 1", () => {
    expect(readSearch("")).toEqual(EMPTY);
    expect(pageQuery(EMPTY)).toBe("");
  });

  it("round-trip the filters and page", () => {
    const query = "person_id=a&person_id=b&location_id=c&tag_id=t1&tag_id=t2&tags=all&from=2026-01-01&to=2026-02-01&page=2&per_page=50&sort=oldest";
    const state = readSearch("?" + query);
    expect(state).toEqual({
      person_ids: ["a", "b"], location_ids: ["c"], tag_ids: ["t1", "t2"], tag_match: "all", from: "2026-01-01", to: "2026-02-01", q: "", page: 2,
      page_size: 50, sort: "oldest",
    });
    expect(pageQuery(state)).toBe(query);
  });

  it("never put the keyword in the URL, or read it from one", () => {
    expect(pageQuery({ ...EMPTY, q: "hip harness" })).toBe("");
    expect(pageQuery({ ...EMPTY, q: "hip harness", from: "2026-01-01", page: 2 })).toBe("from=2026-01-01&page=2");
    expect(readSearch("?q=hip+harness&page=2")).toEqual({ ...EMPTY, page: 2 });
  });

  it("leave out the default tag match, and treat anything but 'all' as 'any'", () => {
    expect(pageQuery({ ...EMPTY, tag_ids: ["t"] })).toBe("tag_id=t");
    expect(readSearch("?tags=bogus").tag_match).toBe("any");
  });

  it("leave out the default page size and sort, and ignore ones it doesn't offer", () => {
    expect(pageQuery({ ...EMPTY, page_size: 20, sort: "newest" })).toBe("");
    expect(pageQuery({ ...EMPTY, page_size: 100 })).toBe("per_page=100");
    expect(readSearch("?per_page=7&sort=random")).toEqual(EMPTY);
  });

  it("ignore a bad page number in the URL", () => {
    for (const page of ["0", "-2", "1.5", "x"]) expect(readSearch(`?page=${page}`).page).toBe(1);
  });
});

describe("hasKeywordInUrl", () => {
  it("spots an old keyword in the URL, even an empty one", () => {
    expect(hasKeywordInUrl("?q=hip&page=2")).toBe(true);
    expect(hasKeywordInUrl("?q=")).toBe(true);
    expect(hasKeywordInUrl("?page=2")).toBe(false);
    expect(hasKeywordInUrl("")).toBe(false);
  });
});

describe("searchBody", () => {
  it("carries every filter and the page, and the keyword's matches but never the keyword", () => {
    const state = {
      person_ids: ["a"], location_ids: ["c"], tag_ids: ["t"], tag_match: /** @type {const} */ ("all"), from: "2026-01-01", to: "", q: "  box tie ", page: 3,
      page_size: 50, sort: /** @type {const} */ ("oldest"),
    };
    const body = searchBody(state, ["t1", "t2"]);
    expect(body).toEqual({
      person_ids: ["a"], location_ids: ["c"], tag_ids: ["t"], tag_match: "all", from: "2026-01-01", to: "", match_ids: ["t1", "t2"], page: 3,
      page_size: 50, sort: "oldest",
    });
    expect(JSON.stringify(body)).not.toContain("box");
    expect(searchBody({ ...state, q: "" }, null).match_ids).toBeNull();
  });
});

describe("hasFilters", () => {
  it("is false for no filters, whatever the page", () => {
    expect(hasFilters({ ...EMPTY, page: 3, q: "  " })).toBe(false);
    expect(hasFilters({ ...EMPTY, tag_match: "all" })).toBe(false);
    expect(hasFilters({ ...EMPTY, page_size: 100, sort: "oldest" })).toBe(false);
  });
  it("is true for any filter", () => {
    expect(hasFilters({ ...EMPTY, person_ids: ["a"] })).toBe(true);
    expect(hasFilters({ ...EMPTY, location_ids: ["a"] })).toBe(true);
    expect(hasFilters({ ...EMPTY, tag_ids: ["a"] })).toBe(true);
    expect(hasFilters({ ...EMPTY, from: "2026-01-01" })).toBe(true);
    expect(hasFilters({ ...EMPTY, to: "2026-01-01" })).toBe(true);
    expect(hasFilters({ ...EMPTY, q: "x" })).toBe(true);
  });
});

describe("pageList", () => {
  it("is empty for one page or none", () => {
    expect(pageList(1, 0)).toEqual([]);
    expect(pageList(1, 1)).toEqual([]);
  });
  it("lists every page when there are few", () => {
    expect(pageList(1, 3)).toEqual([1, 2, 3]);
    expect(pageList(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("shortens long lists around the current page", () => {
    expect(pageList(7, 20)).toEqual([1, null, 6, 7, 8, null, 20]);
    expect(pageList(1, 20)).toEqual([1, 2, null, 20]);
    expect(pageList(20, 20)).toEqual([1, null, 19, 20]);
  });
  it("shows a single skipped page rather than '…'", () => {
    expect(pageList(4, 20)).toEqual([1, 2, 3, 4, 5, null, 20]);
  });
});

describe("sortByName and nameMatches", () => {
  it("sorts A–Z ignoring case", () => {
    expect(sortByName([{ name: "sam" }, { name: "Alex" }, { name: "bea" }]).map((p) => p.name)).toEqual(["Alex", "bea", "sam"]);
  });
  it("matches part of a name, ignoring case", () => {
    expect(nameMatches("Old Flat", "fla")).toBe(true);
    expect(nameMatches("Old Flat", "  ")).toBe(true);
    expect(nameMatches("Old Flat", "studio")).toBe(false);
  });
});
