import { describe, it, expect } from "vitest";
import {
  EMPTY_SEARCH, hasWorkshopFilters, filterWorkshops, isTaught, amountLabel, tieFromWorkshop, moneyOf, splitByMe, workshopDays, dateRangeText, summarise,
  workshopCountText,
} from "../../public/js/workshops-view.js";

/** @param {string | null} id @param {string | null} name @param {string} [role] */
const person = (id, name, role = "top") => ({ id: `l-${id}`, person_id: id, person_name: name, role });

const WORKSHOPS = [
  {
    id: "a", title: "Intro to floor", start_date: "2026-01-10", end_date: null, location_id: "studio", location_name: "Studio",
    attendee_count: 12, rating: 4, description: "Basics of the gote", notes: null, cost: "USD 120.00",
    educators: [person("kit", "Kit")], participants: [person("me", "Me", "bottom"), person("sam", "Sam")], tags: ["Floor"],
  },
  {
    id: "b", title: "Suspension intensive", start_date: "2026-03-01", end_date: "2026-03-03", location_id: "hall", location_name: "Hall",
    attendee_count: null, rating: 5, description: null, notes: "Watch the uplines", cost: "EUR 310.00",
    educators: [person("kit", "Kit"), person("ash", "Ash")], participants: [person("sam", "Sam", "bottom")], tags: ["suspension", "floor"],
  },
  {
    id: "c", title: "Teaching gote", start_date: "2026-05-05", end_date: null, location_id: "studio", location_name: "Studio",
    attendee_count: 8, rating: 3, description: null, notes: null, cost: "USD 650.00",
    educators: [person("me", "Me"), person("ash", "Ash")], participants: [person("bo", "Bo", "bottom"), person(null, null)],
    tags: [],
  },
];

/** @param {Partial<typeof EMPTY_SEARCH>} search */
const ids = (search) => filterWorkshops(/** @type {any} */ (WORKSHOPS), { ...EMPTY_SEARCH, ...search }).map((w) => w.id);

describe("filterWorkshops", () => {
  it("finds a keyword in the title, description or notes, ignoring capitals", () => {
    expect(ids({ q: "GOTE" })).toEqual(["a", "c"]);
    expect(ids({ q: "uplines" })).toEqual(["b"]);
    expect(ids({ q: "  " })).toEqual(["a", "b", "c"]);
  });

  it("finds workshops with all the people chosen, educators or participants", () => {
    expect(ids({ person_ids: ["sam"] })).toEqual(["a", "b"]);
    expect(ids({ person_ids: ["sam", "ash"] })).toEqual(["b"]);
    expect(ids({ person_ids: ["kit"] })).toEqual(["a", "b"]);
  });

  it("finds workshops with all the educators chosen, as educators", () => {
    expect(ids({ educator_ids: ["ash"] })).toEqual(["b", "c"]);
    expect(ids({ educator_ids: ["ash", "kit"] })).toEqual(["b"]);
    // Sam only ever took part.
    expect(ids({ educator_ids: ["sam"] })).toEqual([]);
  });

  it("finds workshops at any of the locations, with a day in the date range", () => {
    expect(ids({ location_ids: ["hall", "nowhere"] })).toEqual(["b"]);
    // b runs 1–3 March, so a range starting on the 2nd still finds it.
    expect(ids({ from: "2026-03-02" })).toEqual(["b", "c"]);
    expect(ids({ to: "2026-03-01" })).toEqual(["a", "b"]);
    expect(ids({ from: "2026-03-04", to: "2026-05-04" })).toEqual([]);
  });

  it("finds any or all of the tags, ignoring capitals", () => {
    expect(ids({ tags: ["FLOOR"] })).toEqual(["a", "b"]);
    expect(ids({ tags: ["floor", "suspension"], tag_match: "all" })).toEqual(["b"]);
    expect(ids({ tags: ["floor", "suspension"], tag_match: "any" })).toEqual(["a", "b"]);
  });

  it("says whether anything narrows the list", () => {
    expect(hasWorkshopFilters(EMPTY_SEARCH)).toBe(false);
    expect(hasWorkshopFilters({ ...EMPTY_SEARCH, q: "  " })).toBe(false);
    expect(hasWorkshopFilters({ ...EMPTY_SEARCH, educator_ids: ["kit"] })).toBe(true);
    expect(hasWorkshopFilters({ ...EMPTY_SEARCH, to: "2026-01-01" })).toBe(true);
  });
});

describe("attended and taught", () => {
  it("are taught when my profile is one of the educators, attended otherwise", () => {
    const w = /** @type {any} */ (WORKSHOPS);
    expect(isTaught(w[2], "me")).toBe(true);
    expect(isTaught(w[0], "me")).toBe(false);
    expect(isTaught(w[2], null)).toBe(false);
    const { attended, taught } = splitByMe(w, "me");
    expect(attended.map((x) => x.id)).toEqual(["a", "b"]);
    expect(taught.map((x) => x.id)).toEqual(["c"]);
  });

  it("label the cost Earned once I'm one of the educators", () => {
    expect(amountLabel([], "me")).toBe("Cost");
    expect(amountLabel(["kit"], "me")).toBe("Cost");
    expect(amountLabel(["kit", "me"], "me")).toBe("Earned");
    expect(amountLabel(["me"], null)).toBe("Cost");
  });
});

describe("dates", () => {
  it("count the days a workshop ran, inclusive", () => {
    expect(workshopDays({ start_date: "2026-03-01", end_date: null })).toBe(1);
    expect(workshopDays({ start_date: "2026-03-01", end_date: "2026-03-03" })).toBe(3);
    // Across the clocks changing and a month's end.
    expect(workshopDays({ start_date: "2026-03-28", end_date: "2026-04-02" })).toBe(6);
  });

  it("say one date, or the range", () => {
    expect(dateRangeText({ start_date: "2026-03-01", end_date: null }, "en-US")).toBe("Mar 1, 2026");
    expect(dateRangeText({ start_date: "2026-03-01", end_date: "2026-03-03" }, "en-US")).toBe("Mar 1, 2026 – Mar 3, 2026");
    expect([0, 1, 2].map(workshopCountText)).toEqual(["0 workshops", "1 workshop", "2 workshops"]);
  });
});

describe("summarise", () => {
  it("counts what I attended: days, educators, locations, partners, rating, tops and dates", () => {
    const { attended } = splitByMe(/** @type {any} */ (WORKSHOPS), "me");
    expect(summarise(attended, "me")).toEqual({
      workshops: 2, days: 4, locations: 2, partners: 1, educators: 2, attendees: 12, averageRating: 4.5,
      topEducators: [{ name: "Kit", count: 2 }, { name: "Ash", count: 1 }],
      // Counted ignoring capitals, named as first written.
      topTags: [{ name: "Floor", count: 2 }, { name: "suspension", count: 1 }],
      first: { title: "Intro to floor", date: "2026-01-10" },
      latest: { title: "Suspension intensive", date: "2026-03-01" },
      // One workshop each: the larger total comes first.
      money: [{ currency: "EUR", minor: 31000, count: 1 }, { currency: "USD", minor: 12000, count: 1 }],
      averageMoney: { currency: "EUR", minor: 31000 },
    });
  });

  it("counts what I taught, leaving me and deleted people out", () => {
    const { taught } = splitByMe(/** @type {any} */ (WORKSHOPS), "me");
    expect(summarise(taught, "me")).toMatchObject({
      workshops: 1, days: 1, locations: 1, partners: 1, educators: 1, attendees: 8, averageRating: 3,
      topEducators: [{ name: "Ash", count: 1 }],
      // On one I taught, it's what I earned.
      money: [{ currency: "USD", minor: 65000, count: 1 }],
    });
  });

  it("averages the money in the most used currency, over the ones with a cost in it", () => {
    const w = [{ cost: "USD 100.00" }, { cost: "USD 51.00" }, { cost: "GBP 900.00" }, { cost: null }];
    expect(moneyOf(w)).toEqual({
      money: [{ currency: "USD", minor: 15100, count: 2 }, { currency: "GBP", minor: 90000, count: 1 }],
      averageMoney: { currency: "USD", minor: 7550 },
    });
    expect(moneyOf([{ cost: null }])).toEqual({ money: [], averageMoney: null });
  });

  it("is empty for no workshops", () => {
    expect(summarise([], "me")).toEqual({
      workshops: 0, days: 0, locations: 0, partners: 0, educators: 0, attendees: 0, averageRating: null,
      topEducators: [], topTags: [], first: null, latest: null, money: [], averageMoney: null,
    });
  });
});

describe("a new tie from a workshop", () => {
  const workshop = {
    id: "w", title: "Intensive", start_date: "2026-11-06", end_date: "2026-11-08", location_id: "loc", location_name: "Studio",
    educators: [{ id: "e", person_id: "kit", person_name: "Kit", role: "top" }],
    participants: [
      { id: "1", person_id: "me", person_name: "Me", role: "bottom" },
      { id: "2", person_id: "sam", person_name: "Sam", role: "audit" },
      { id: "3", person_id: null, person_name: null, role: "top" },
    ],
  };

  it("is linked to it, at its location, with its people (not educators), audit left blank", () => {
    expect(tieFromWorkshop(workshop, "2026-11-07")).toEqual({
      workshop_id: "w", workshop_title: "Intensive", tie_date: "2026-11-07", location_id: "loc", location_name: "Studio",
      people: [{ person_id: "me", person_name: "Me", role: "bottom" }, { person_id: "sam", person_name: "Sam", role: null }],
    });
  });

  it("is dated today while the workshop is on, otherwise its start date", () => {
    expect(tieFromWorkshop(workshop, "2026-11-06").tie_date).toBe("2026-11-06");
    expect(tieFromWorkshop(workshop, "2026-11-08").tie_date).toBe("2026-11-08");
    expect(tieFromWorkshop(workshop, "2026-11-09").tie_date).toBe("2026-11-06");
    expect(tieFromWorkshop(workshop, "2026-10-01").tie_date).toBe("2026-11-06");
    const oneDay = { ...workshop, end_date: null };
    expect(tieFromWorkshop(oneDay, "2026-11-06").tie_date).toBe("2026-11-06");
    expect(tieFromWorkshop(oneDay, "2026-11-07").tie_date).toBe("2026-11-06");
  });

  it("has no location when the workshop's was deleted", () => {
    expect(tieFromWorkshop({ ...workshop, location_id: null, location_name: null }, "2026-11-07"))
      .toMatchObject({ location_id: null, location_name: null });
  });
});
