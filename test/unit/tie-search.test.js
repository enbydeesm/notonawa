// The Ties page's search state (public/js/tie-search.js). No DOM needed.
import { describe, it, expect } from "vitest";
import {
  readSearch, searchQuery, hasFilters, pageList, sortByName, nameMatches,
} from "../../public/js/tie-search.js";

const EMPTY = { person_ids: [], location_ids: [], from: "", to: "", q: "", page: 1 };

describe("readSearch and searchQuery", () => {
  it("start empty on page 1", () => {
    expect(readSearch("")).toEqual(EMPTY);
    expect(searchQuery(EMPTY)).toBe("");
  });

  it("round-trip every filter", () => {
    const query = "person_id=a&person_id=b&location_id=c&from=2026-01-01&to=2026-02-01&q=hip+harness&page=2";
    const state = readSearch("?" + query);
    expect(state).toEqual({
      person_ids: ["a", "b"], location_ids: ["c"], from: "2026-01-01", to: "2026-02-01", q: "hip harness", page: 2,
    });
    expect(searchQuery(state)).toBe(query);
  });

  it("leave out page 1, blank keywords and trim the keyword", () => {
    expect(searchQuery({ ...EMPTY, q: "   " })).toBe("");
    expect(searchQuery({ ...EMPTY, q: " box tie ", page: 1 })).toBe("q=box+tie");
  });

  it("ignore a bad page number in the URL", () => {
    for (const page of ["0", "-2", "1.5", "x"]) expect(readSearch(`?page=${page}`).page).toBe(1);
  });
});

describe("hasFilters", () => {
  it("is false for no filters, whatever the page", () => {
    expect(hasFilters({ ...EMPTY, page: 3, q: "  " })).toBe(false);
  });
  it("is true for any filter", () => {
    expect(hasFilters({ ...EMPTY, person_ids: ["a"] })).toBe(true);
    expect(hasFilters({ ...EMPTY, location_ids: ["a"] })).toBe(true);
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
