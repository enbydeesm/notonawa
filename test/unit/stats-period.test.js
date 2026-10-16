import { describe, it, expect } from "vitest";
import {
  initialPeriod, periodRange, canStep, stepPeriod, periodTitle, bucketUnit, chartSpan, buckets, monthGrid, monthRange, addDays,
} from "../../public/js/stats-period.js";

const TODAY = "2026-10-15";

/** @param {Partial<import("../../public/js/stats-period.js").PeriodState>} changes */
const state = (changes) => ({ ...initialPeriod(TODAY), ...changes });

describe("periodRange", () => {
  it("starts on this year", () => {
    expect(initialPeriod(TODAY)).toEqual({ period: "year", anchor: TODAY, from: "", to: "" });
    expect(periodRange(initialPeriod(TODAY), TODAY)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("covers a whole month, leap Februaries included", () => {
    expect(periodRange(state({ period: "month" }), TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange(state({ period: "month", anchor: "2028-02-10" }), TODAY)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("counts back from today for the last 365 days and 4 weeks", () => {
    expect(periodRange(state({ period: "last365" }), TODAY)).toEqual({ from: "2025-10-16", to: TODAY });
    expect(periodRange(state({ period: "last4w" }), TODAY)).toEqual({ from: "2026-09-18", to: TODAY });
  });

  it("is open for all time and an unfinished custom range", () => {
    expect(periodRange(state({ period: "all" }), TODAY)).toEqual({ from: null, to: null });
    expect(periodRange(state({ period: "custom", from: "2026-01-05" }), TODAY)).toEqual({ from: "2026-01-05", to: null });
  });
});

describe("stepping through periods", () => {
  it("steps a year or a month at a time, across year ends", () => {
    expect(canStep("year")).toBe(true);
    expect(canStep("month")).toBe(true);
    expect(canStep("all")).toBe(false);
    expect(stepPeriod(state({}), -1).anchor).toBe("2025-01-01");
    expect(stepPeriod(state({ period: "month", anchor: "2026-01-20" }), -1).anchor).toBe("2025-12-01");
    expect(stepPeriod(state({ period: "month", anchor: "2026-12-31" }), 1).anchor).toBe("2027-01-01");
    const last = state({ period: "last365" });
    expect(stepPeriod(last, 1)).toBe(last);
  });

  it("names each period", () => {
    expect(periodTitle(state({}), "en-US")).toBe("2026");
    expect(periodTitle(state({ period: "month" }), "en-US")).toBe("October 2026");
    expect(periodTitle(state({ period: "last4w" }), "en-US")).toBe("Last 4 weeks");
    expect(periodTitle(state({ period: "all" }), "en-US")).toBe("All time");
    expect(periodTitle(state({ period: "custom" }), "en-US")).toBe("Choose dates");
    expect(periodTitle(state({ period: "custom", from: "2026-01-05", to: "2026-02-01" }), "en-US")).toBe("Jan 5, 2026 – Feb 1, 2026");
    expect(periodTitle(state({ period: "custom", from: "2026-01-05" }), "en-US")).toBe("From Jan 5, 2026");
  });
});

describe("bucketUnit", () => {
  it("uses months for a year and days for a month", () => {
    const span = { from: "2026-01-01", to: "2026-12-31" };
    expect(bucketUnit("year", span)).toBe("month");
    expect(bucketUnit("last365", span)).toBe("month");
    expect(bucketUnit("month", span)).toBe("day");
    expect(bucketUnit("last4w", span)).toBe("day");
  });

  it("uses years for all time, unless the ties cover less than a year", () => {
    expect(bucketUnit("all", { from: "2024-03-01", to: TODAY })).toBe("year");
    expect(bucketUnit("all", { from: "2026-01-01", to: TODAY })).toBe("month");
  });

  it("uses days for a custom range up to six weeks, then months", () => {
    expect(bucketUnit("custom", { from: "2026-01-01", to: "2026-02-11" })).toBe("day"); // 42 days
    expect(bucketUnit("custom", { from: "2026-01-01", to: "2026-02-12" })).toBe("month");
  });
});

describe("chartSpan", () => {
  const ties = [{ tie_date: "2024-05-01" }, { tie_date: "2026-03-01" }];
  it("keeps a closed range as it is", () => {
    expect(chartSpan({ from: "2026-01-01", to: "2026-12-31" }, ties, TODAY)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
  it("fills an open start from the first tie, and an open end with today", () => {
    expect(chartSpan({ from: null, to: null }, ties, TODAY)).toEqual({ from: "2024-05-01", to: TODAY });
    expect(chartSpan({ from: null, to: null }, [], TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(chartSpan({ from: null, to: null }, [{ tie_date: "2027-01-01" }], TODAY)).toEqual({ from: TODAY, to: "2027-01-01" });
  });
});

describe("buckets", () => {
  const ties = [
    { id: "a", tie_date: "2026-01-03" },
    { id: "b", tie_date: "2026-01-03" },
    { id: "c", tie_date: "2026-03-30" },
    { id: "outside", tie_date: "2025-12-31" },
  ];

  it("makes a bar per month, counting each month's ties and keeping their ids", () => {
    const bars = buckets("month", { from: "2026-01-01", to: "2026-12-31" }, ties, "en-US");
    expect(bars).toHaveLength(12);
    expect(bars[0]).toEqual({ key: "2026-01", label: "Jan", title: "January 2026", count: 2, tieIds: ["a", "b"] });
    expect(bars[1].count).toBe(0);
    expect(bars[2]).toMatchObject({ label: "Mar", count: 1, tieIds: ["c"] });
  });

  it("runs months across a year end", () => {
    const bars = buckets("month", { from: "2025-10-16", to: "2026-10-15" }, ties, "en-US");
    expect(bars.map((b) => b.key)).toEqual([
      "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04",
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(bars[2].count).toBe(1);
  });

  it("makes a bar per day, labelled with the day of the month", () => {
    const bars = buckets("day", { from: "2026-01-01", to: "2026-01-31" }, ties, "en-US");
    expect(bars).toHaveLength(31);
    expect(bars[2]).toEqual({ key: "2026-01-03", label: "3", title: "January 3", count: 2, tieIds: ["a", "b"] });
  });

  it("makes a bar per year", () => {
    expect(buckets("year", { from: "2025-06-01", to: "2026-10-15" }, ties, "en-US").map((b) => [b.label, b.count]))
      .toEqual([["2025", 1], ["2026", 3]]);
  });
});

describe("the calendar's month", () => {
  it("knows the blank days before the 1st (weeks start on Sunday) and the month's length", () => {
    expect(monthGrid(2026, 10)).toEqual({ lead: 4, days: 31 }); // Oct 1 2026 is a Thursday
    expect(monthGrid(2026, 2)).toEqual({ lead: 0, days: 28 });
    expect(monthRange("2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("adds days across months", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});
