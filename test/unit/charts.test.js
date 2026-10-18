// What the charts say about a bar, in words (public/js/charts.js). No DOM needed.
import { describe, it, expect, afterEach } from "vitest";
import { describeParts, SEGMENT_COLORS, TYPE_COLORS } from "../../public/js/charts.js";
import { setRoleNames } from "../../public/js/roles.js";
import { TIE_TYPES } from "../../public/js/ties-view.js";

const part = (/** @type {any} */ key, /** @type {number} */ count) => ({ key, count, tieIds: [] });

describe("describeParts", () => {
  afterEach(() => setRoleNames(null));

  it("gives the count, then each role's share, by my names for them", () => {
    expect(describeParts({ count: 13, segments: [part("top", 7), part("bottom", 5), part("self tie", 1)] }))
      .toBe("13 ties, 7 as top, 5 as bottom, 1 as self tie");
    setRoleNames({ top_label: "rigger", bottom_label: null });
    expect(describeParts({ count: 3, segments: [part("top", 3)] })).toBe("3 ties, as rigger");
  });

  it("is just the count without parts, or when they're grey", () => {
    expect(describeParts({ count: 1 })).toBe("1 tie");
    expect(describeParts({ count: 4, segments: [part("other", 4)] })).toBe("4 ties");
  });
});

describe("chart colors", () => {
  it("give top, bottom and self tie their own colors, and each tie type one", () => {
    expect(SEGMENT_COLORS).toEqual({ top: "c-yellow", bottom: "c-purple", "self tie": "c-teal", other: "c-grey" });
    expect(TIE_TYPES.map((type) => TYPE_COLORS[type])).toEqual(["c-yellow", "c-purple", "c-teal", "c-coral"]);
  });
});
