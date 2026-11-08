import { describe, it, expect } from "vitest";
import { workshopsIn, followUps, workshopNumbers, practisedMost, workshopsByBar, workshopPlaces } from "../../public/js/workshop-stats.js";
import { buckets } from "../../public/js/stats-period.js";

/** @param {string | null} id @param {string} [role] */
const person = (id, role = "top") => ({ id: `l-${id}`, person_id: id, person_name: id, role });

const WORKSHOPS = /** @type {any[]} */ ([
  {
    id: "a", title: "Intensive", start_date: "2026-03-01", end_date: "2026-03-03", location_id: "studio", cost: "USD 300.00",
    educators: [person("kit")], participants: [person("me")], tags: [],
    linked: [{ kind: "plan", id: "gote" }, { kind: "tie", id: "t-at" }],
  },
  {
    id: "b", title: "Teaching floor", start_date: "2026-06-10", end_date: null, location_id: "hall", cost: "USD 150.00",
    educators: [person("me")], participants: [person("sam")], tags: [], linked: [],
  },
  {
    id: "c", title: "Abroad", start_date: "2026-09-01", end_date: null, location_id: null, cost: "EUR 80.00",
    educators: [person("ash")], participants: [], tags: [], linked: [{ kind: "plan", id: "hip" }],
  },
  {
    id: "old", title: "Last year", start_date: "2025-05-01", end_date: null, location_id: "studio", cost: null,
    educators: [person("kit")], participants: [], tags: [], linked: [],
  },
]);

// A plan from the intensive, tied at it (t-at) and after (t1, t2); one from
// abroad, tied once; one from no workshop.
const PLANS = [
  { id: "gote", workshop_id: "a", linked_ties: [{ id: "t-at" }, { id: "t1" }, { id: "t2" }] },
  { id: "hip", workshop_id: "c", linked_ties: [{ id: "t3" }] },
  { id: "mine", workshop_id: null, linked_ties: [{ id: "t4" }] },
];

describe("workshops in analytics", () => {
  it("follow the period by their start date", () => {
    expect(workshopsIn(WORKSHOPS, { from: "2026-01-01", to: "2026-12-31" }).map((w) => w.id)).toEqual(["a", "b", "c"]);
    expect(workshopsIn(WORKSHOPS, { from: "2026-03-02", to: null }).map((w) => w.id)).toEqual(["b", "c"]);
    expect(workshopsIn(WORKSHOPS, { from: null, to: null })).toHaveLength(4);
  });

  it("count as follow-ups the ties on their plans, not the ties at the workshop itself", () => {
    const f = followUps(WORKSHOPS, PLANS);
    expect([...(f.get("a") ?? [])]).toEqual(["t1", "t2"]);
    expect([...(f.get("c") ?? [])]).toEqual(["t3"]);
    expect(f.get("b")?.size).toBe(0);
  });

  it("number the period's: attended and taught, days, spend and earned per currency, and follow-up ties", () => {
    const year = workshopsIn(WORKSHOPS, { from: "2026-01-01", to: "2026-12-31" });
    const ties = ["t-at", "t1", "t3", "t4", "t9"].map((id) => ({ id }));
    expect(workshopNumbers(year, followUps(WORKSHOPS, PLANS), ties, "me")).toEqual({
      attended: 2, taught: 1, days: 5,
      spend: [{ currency: "EUR", minor: 8000, count: 1 }, { currency: "USD", minor: 30000, count: 1 }]
        .sort((x, y) => y.minor - x.minor),
      earned: [{ currency: "USD", minor: 15000, count: 1 }],
      // t1 and t3 of the five.
      followUps: 2, followUpShare: 40,
    });
    expect(workshopNumbers([], new Map(), [], "me").followUpShare).toBe(0);
  });

  it("rank Practised most by follow-up ties, leaving out ones with none", () => {
    const f = followUps(WORKSHOPS, PLANS);
    expect(practisedMost(WORKSHOPS, f)).toEqual([
      { id: "a", title: "Intensive", tieIds: ["t1", "t2"] },
      { id: "c", title: "Abroad", tieIds: ["t3"] },
    ]);
    expect(practisedMost(WORKSHOPS, f, 1)).toHaveLength(1);
  });

  it("mark the tie count's bars they start in", () => {
    const months = buckets("month", { from: "2026-01-01", to: "2026-12-31" }, [], "en-US");
    const marks = workshopsByBar(months, WORKSHOPS);
    expect(marks.map((list) => list.map((w) => w.id))).toEqual([[], [], ["a"], [], [], ["b"], [], [], ["c"], [], [], []]);
    const days = buckets("day", { from: "2026-06-09", to: "2026-06-11" }, [], "en-US");
    expect(workshopsByBar(days, WORKSHOPS).map((list) => list.length)).toEqual([0, 1, 0]);
  });

  it("put the ones at a location with coordinates on the map, one place per location", () => {
    const places = workshopPlaces(WORKSHOPS, [
      { id: "studio", name: "Studio", latitude: 47.6, longitude: -122.3 },
      { id: "hall", name: "Hall", latitude: null, longitude: null },
    ]);
    expect(places.map((p) => [p.key, p.label, p.workshopIds])).toEqual([["studio", "Studio", ["a", "old"]]]);
    expect(typeof places[0].x).toBe("number");
  });
});
