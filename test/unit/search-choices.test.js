import { describe, it, expect } from "vitest";
import { searchChoices, addOffer, pickerSource, RECENT_COUNT } from "../../public/js/search-choices.js";

/**
 * @param {string} id
 * @param {string} name
 * @param {string} created_at
 */
const item = (id, name, created_at) => ({ id, name, created_at });

const items = [
  item("a", "Studio", "2026-01-01T00:00:00Z"),
  item("b", "Home", "2026-02-01T00:00:00Z"),
  item("c", "Hotel", "2026-03-01T00:00:00Z"),
  item("d", "Dungeon", "2026-04-01T00:00:00Z"),
  item("e", "Park", "2026-05-01T00:00:00Z"),
  item("f", "Attic", "2026-06-01T00:00:00Z"),
  item("g", "Barn", "2026-07-01T00:00:00Z"),
];
const archived = [item("z", "Old flat", "2025-01-01T00:00:00Z")];
const ids = (/** @type {{ id: string }[]} */ list) => list.map((l) => l.id);

describe("searchChoices", () => {
  it("with nothing typed, shows the most recently on a tie first, topped up with the newest added", () => {
    expect(ids(searchChoices(items, ["b", "a"], ""))).toEqual(["b", "a", "g", "f", "e"]);
    expect(RECENT_COUNT).toBe(5);
  });

  it("shows at most five recent ones, and skips ids it doesn't have (e.g. archived since)", () => {
    expect(ids(searchChoices(items, ["a", "x", "b", "c", "d", "e", "f"], " "))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("with no ties yet, shows the newest added", () => {
    expect(ids(searchChoices(items, [], ""))).toEqual(["g", "f", "e", "d", "c"]);
    expect(searchChoices([], [], "")).toEqual([]);
  });

  it("with something typed, searches every item by any part of the name, ignoring capitals, A–Z", () => {
    expect(ids(searchChoices(items, ["b"], "O"))).toEqual(["d", "b", "c", "a"]);
    expect(ids(searchChoices(items, [], "ARK"))).toEqual(["e"]);
    expect(searchChoices(items, [], "zzz")).toEqual([]);
  });
});

describe("searchChoices with my own profile", () => {
  const me = { ...item("me", "Jordan", "2020-01-01T00:00:00Z"), isSelf: true };
  const people = [...items, me];

  it("with nothing typed, lists me first, then five others, whether or not I'm recent", () => {
    expect(ids(searchChoices(people, ["b", "me", "a"], ""))).toEqual(["me", "b", "a", "g", "f", "e"]);
    expect(ids(searchChoices(people, [], ""))).toEqual(["me", "g", "f", "e", "d", "c"]);
  });

  it("with something typed, lists me first only if I match", () => {
    expect(ids(searchChoices(people, [], "o"))).toEqual(["me", "d", "b", "c", "a"]);
    expect(ids(searchChoices(people, [], "ark"))).toEqual(["e"]);
  });
});

describe("addOffer", () => {
  it("offers to add what's typed, tidied, unless it's empty", () => {
    expect(addOffer(items, archived, "  Back   garden ")).toEqual({ add: "Back garden" });
    expect(addOffer(items, archived, "   ")).toBeNull();
  });

  it("offers nothing for a name already in the list, ignoring capitals, but does for one that only contains it", () => {
    expect(addOffer(items, archived, "studio")).toBeNull();
    expect(addOffer(items, archived, " HOTEL ")).toBeNull();
    expect(addOffer(items, archived, "Stud")).toEqual({ add: "Stud" });
    expect(addOffer(items, archived, "Studio 2")).toEqual({ add: "Studio 2" });
  });

  it("points to an archived one with that name instead of adding a second", () => {
    expect(addOffer(items, archived, "old  FLAT")).toEqual({ archived: "Old flat" });
    expect(addOffer(items, archived, "Old")).toEqual({ add: "Old" });
  });
});

describe("pickerSource", () => {
  it("splits active from archived, names plans by title, and labels me", () => {
    const rows = [
      { id: "p1", name: "Sam", is_self: 0, default_role: "model", archived_at: null, created_at: "t1" },
      { id: "p2", name: "Me", is_self: 1, archived_at: null, created_at: "t2" },
      { id: "p3", name: "Alex", is_self: 0, archived_at: "2026-01-01T00:00:00Z", created_at: "t3" },
      { id: "pl", title: "Hip harness", archived_at: null, created_at: "t4" },
    ];
    expect(pickerSource(rows, ["p2"])).toEqual({
      active: [
        { id: "p1", name: "Sam", created_at: "t1", defaultRole: "model" },
        { id: "p2", name: "Me", label: "Me (you)", isSelf: true, created_at: "t2" },
        { id: "pl", name: "Hip harness", created_at: "t4" },
      ],
      archived: [{ id: "p3", name: "Alex", created_at: "t3" }],
      recent: ["p2"],
    });
  });
});
