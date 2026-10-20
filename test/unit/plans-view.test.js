import { describe, it, expect } from "vitest";
import { tieSummary, tieCountText, filterPlans, hasPlanFilters, EMPTY_SEARCH } from "../../public/js/plans-view.js";

/** @param {number | null} success_rating */
const tie = (success_rating) => ({ id: "t", title: "x", tie_date: "2026-01-01", success_rating });

describe("tieSummary", () => {
  it("counts the ties and averages the rated ones, to one decimal place", () => {
    expect(tieSummary([tie(3), tie(4), tie(4), tie(null)])).toEqual({ count: 4, average: 3.7 });
    expect(tieSummary([tie(null)])).toEqual({ count: 1, average: null });
    expect(tieSummary([])).toEqual({ count: 0, average: null });
  });

  it("says how many", () => {
    expect([0, 1, 2].map(tieCountText)).toEqual(["0 ties", "1 tie", "2 ties"]);
  });
});

describe("filterPlans", () => {
  const plans = [
    { id: "a", title: "Hip harness", description: "Start with a gote", notes: null, plan_type: "harness", tie_type: "floor", tags: ["Kata"] },
    { id: "b", title: "Futomomo", description: null, notes: "Watch the knee", plan_type: "idea", tie_type: null, tags: ["kata", "leg"] },
    { id: "c", title: "Sequence one", description: null, notes: null, plan_type: "sequence", tie_type: "suspension", tags: [] },
  ];
  /** @param {Partial<typeof EMPTY_SEARCH>} search */
  const ids = (search) => filterPlans(plans, { ...EMPTY_SEARCH, ...search }).map((p) => p.id);

  it("finds a keyword in the title, description or notes, ignoring capitals", () => {
    expect(ids({ q: "HIP" })).toEqual(["a"]);
    expect(ids({ q: " gote " })).toEqual(["a"]);
    expect(ids({ q: "knee" })).toEqual(["b"]);
    expect(ids({ q: "   " })).toEqual(["a", "b", "c"]);
  });

  it("matches any of the chosen plan types and tie types", () => {
    expect(ids({ plan_types: ["idea", "sequence"] })).toEqual(["b", "c"]);
    expect(ids({ tie_types: ["floor", "suspension"] })).toEqual(["a", "c"]);
    // A plan without a tie type matches none.
    expect(ids({ tie_types: ["hashira"] })).toEqual([]);
  });

  it("matches any or all of the tags, ignoring capitals", () => {
    expect(ids({ tags: ["KATA", "leg"] })).toEqual(["a", "b"]);
    expect(ids({ tags: ["kata", "leg"], tag_match: "all" })).toEqual(["b"]);
  });

  it("needs every filter to match", () => {
    expect(ids({ q: "a", plan_types: ["harness"], tags: ["kata"] })).toEqual(["a"]);
  });

  it("knows when anything narrows the list", () => {
    expect(hasPlanFilters(EMPTY_SEARCH)).toBe(false);
    expect(hasPlanFilters({ ...EMPTY_SEARCH, q: "  " })).toBe(false);
    expect(hasPlanFilters({ ...EMPTY_SEARCH, tie_types: ["floor"] })).toBe(true);
    expect(hasPlanFilters({ ...EMPTY_SEARCH, tag_match: "all" })).toBe(false);
  });
});
