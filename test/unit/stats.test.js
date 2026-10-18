import { describe, it, expect } from "vitest";
import {
  summarize, topPartners, typeShares, weekdayShares, locationShares, tiesByDay, percent, formatTotalTime, tieListHeading,
  myRole, roleChartTies, withSegments,
} from "../../public/js/stats.js";

/** @typedef {import("../../public/js/stats.js").StatsTie} StatsTie */

const ME = { person_id: "me", person_name: "Me", is_self: true };

/**
 * @param {string} id
 * @param {Partial<StatsTie>} fields
 * @returns {StatsTie}
 */
function tie(id, fields) {
  return {
    id, tie_date: "2026-10-01", tie_type: null, duration_minutes: null, success_rating: null,
    location_id: null, location_deleted: 0, location_name: null, participants: [], ...fields,
  };
}

/** @param {string} id @param {string} name @param {string} role */
const person = (id, name, role) => ({ person_id: id, person_name: name, is_self: false, role });

describe("summarize", () => {
  it("counts ties, partners, locations, days, roles, time and rating", () => {
    const ties = [
      tie("1", { tie_date: "2026-10-01", location_id: "studio", duration_minutes: 60, success_rating: 5,
        participants: [{ ...ME, role: "top" }, person("sam", "Sam", "bottom"), person("pat", "Pat", "photographer")] }),
      tie("2", { tie_date: "2026-10-01", location_id: "studio", duration_minutes: 90, success_rating: 4,
        participants: [{ ...ME, role: "bottom" }, person("sam", "Sam", "top")] }),
      tie("3", { tie_date: "2026-10-05", location_id: "park",
        participants: [{ ...ME, role: "spotter" }, person("alex", "Alex", "top"), person("kim", "Kim", "spotter")] }),
    ];
    expect(summarize(ties)).toEqual({
      ties: 3, partners: 2, locations: 2, days: 2, asTop: 1, asBottom: 1,
      minutes: 150, avgMinutes: 75, avgRating: 4.5,
    });
  });

  it("leaves out averages with nothing to average", () => {
    expect(summarize([])).toEqual({
      ties: 0, partners: 0, locations: 0, days: 0, asTop: 0, asBottom: 0, minutes: 0, avgMinutes: null, avgRating: null,
    });
  });
});

describe("topPartners", () => {
  it("counts each partner once per tie, most first then by name, without me, spotters, photographers or the deleted", () => {
    const ties = [
      tie("1", { participants: [{ ...ME, role: "top" }, person("sam", "Sam", "bottom"), person("sam", "Sam", "bottom")] }),
      tie("2", { participants: [person("sam", "Sam", "bottom"), person("alex", "Alex", "top")] }),
      tie("3", { participants: [person("bo", "Bo", "bottom"), person("kim", "Kim", "photographer")] }),
      tie("4", { participants: [person("kim", "Kim", "spotter"), { person_id: null, person_name: null, is_self: false, role: "bottom" }] }),
      // Kim tying here counts, though Kim only spotted elsewhere.
      tie("5", { participants: [person("kim", "Kim", "spotter"), person("kim", "Kim", "bottom")] }),
    ];
    expect(topPartners(ties, 10)).toEqual([
      { key: "sam", label: "Sam", count: 2, tieIds: ["1", "2"] },
      { key: "alex", label: "Alex", count: 1, tieIds: ["2"] },
      { key: "bo", label: "Bo", count: 1, tieIds: ["3"] },
      { key: "kim", label: "Kim", count: 1, tieIds: ["5"] },
    ]);
    expect(topPartners(ties, 2).map((s) => s.key)).toEqual(["sam", "alex"]);
  });
});

describe("typeShares", () => {
  it("keeps the types in order, with untyped ties last, and only those with ties", () => {
    const ties = [tie("1", { tie_type: "floor" }), tie("2", { tie_type: "suspension" }), tie("3", { tie_type: "floor" }), tie("4", {})];
    expect(typeShares(ties)).toEqual([
      { key: "suspension", label: "Suspension", count: 1, tieIds: ["2"] },
      { key: "floor", label: "Floor", count: 2, tieIds: ["1", "3"] },
      { key: "none", label: "Not set", count: 1, tieIds: ["4"] },
    ]);
  });
});

describe("weekdayShares", () => {
  it("counts ties by weekday, every day from Sunday to Saturday", () => {
    const ties = [
      tie("1", { tie_date: "2026-10-03" }), // Saturday
      tie("2", { tie_date: "2026-10-10" }), // Saturday
      tie("3", { tie_date: "2026-10-05" }), // Monday
      tie("4", { tie_date: "2026-10-04" }), // Sunday
    ];
    expect(weekdayShares(ties).map((s) => [s.label, s.count])).toEqual([
      ["Sun", 1], ["Mon", 1], ["Tue", 0], ["Wed", 0], ["Thu", 0], ["Fri", 0], ["Sat", 2],
    ]);
    expect(weekdayShares(ties)[6].tieIds).toEqual(["1", "2"]);
  });
});

describe("role-colored charts", () => {
  const as = (/** @type {string} */ id, /** @type {string[]} */ roles) =>
    tie(id, { participants: [...roles.map((role) => ({ ...ME, role })), person("sam", "Sam", "bottom")] });
  const ties = [
    as("1", ["top"]), as("2", ["bottom"]), as("3", ["self tie"]), as("4", ["spotter"]),
    as("5", ["top", "bottom"]), as("6", ["photographer"]), tie("7", { participants: [person("sam", "Sam", "top")] }),
  ];

  it("know my role on a tie: a switch counts as top; spotting, photos or not being on it is none", () => {
    expect(ties.map(myRole)).toEqual(["top", "bottom", "self tie", null, "top", null, null]);
  });

  it("count only top, bottom and self tie ties, by role", () => {
    const { ties: counted, segmentOf } = roleChartTies(ties, "all");
    expect(counted.map((t) => t.id)).toEqual(["1", "2", "3", "5"]);
    expect(counted.map(segmentOf)).toEqual(["top", "bottom", "self tie", "top"]);
    expect(roleChartTies(ties, "top").ties).toHaveLength(4);
  });

  it("count every tie, grey, with the filter on spotter or photographer", () => {
    for (const filter of ["spotter", "photographer"]) {
      const { ties: counted, segmentOf } = roleChartTies(ties, filter);
      expect(counted).toHaveLength(7);
      expect(new Set(counted.map(segmentOf))).toEqual(new Set(["other"]));
    }
  });

  it("split each bar into its parts, in order, adding up to the bar", () => {
    const { ties: counted, segmentOf } = roleChartTies(ties, "all");
    const bars = [
      { key: "a", count: 3, tieIds: ["3", "2", "1"] },
      { key: "b", count: 1, tieIds: ["5"] },
      { key: "c", count: 0, tieIds: [] },
    ];
    expect(withSegments(bars, counted, segmentOf).map((b) => b.segments)).toEqual([
      [{ key: "top", count: 1, tieIds: ["1"] }, { key: "bottom", count: 1, tieIds: ["2"] }, { key: "self tie", count: 1, tieIds: ["3"] }],
      [{ key: "top", count: 1, tieIds: ["5"] }],
      [],
    ]);
  });
});

describe("locationShares", () => {
  const at = (/** @type {string} */ id, /** @type {string} */ location) =>
    tie(id, { location_id: location, location_name: location.toUpperCase() });

  it("shows the busiest few, and the rest together as Other", () => {
    const ties = [at("1", "a"), at("2", "a"), at("3", "b"), at("4", "c"), at("5", "d"), at("6", "e"), tie("7", {}), tie("8", { location_deleted: 1 })];
    const slices = locationShares(ties, 4);
    expect(slices.map((s) => [s.label, s.count])).toEqual([["A", 2], ["(location deleted)", 1], ["B", 1], ["C", 1], ["Other", 3]]);
    expect(slices[4].tieIds.sort()).toEqual(["5", "6", "7"]);
  });

  it("doesn't make an Other of just one place", () => {
    const ties = [at("1", "a"), at("2", "b"), at("3", "c"), at("4", "d"), at("5", "e")];
    expect(locationShares(ties, 4).map((s) => s.label)).toEqual(["A", "B", "C", "D", "E"]);
  });
});

describe("small helpers", () => {
  it("groups ties by day", () => {
    expect(tiesByDay([tie("1", { tie_date: "2026-10-08" }), tie("2", { tie_date: "2026-10-08" }), tie("3", { tie_date: "2026-10-09" })]))
      .toEqual(new Map([["2026-10-08", ["1", "2"]], ["2026-10-09", ["3"]]]));
  });

  it("rounds percentages, and is 0 out of nothing", () => {
    expect(percent(4, 7)).toBe(57);
    expect(percent(0, 0)).toBe(0);
  });

  it("shows total time in hours, or minutes under an hour", () => {
    expect(formatTotalTime(45)).toBe("45m");
    expect(formatTotalTime(5880)).toBe("≈98h");
  });
});

describe("tieListHeading", () => {
  it("names what was tapped and how many ties it has", () => {
    expect(tieListHeading("March 2026", 8)).toBe("March 2026 · 8 ties");
    expect(tieListHeading("Lily", 1)).toBe("Lily · 1 tie");
  });
});
