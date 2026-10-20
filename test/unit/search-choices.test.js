import { describe, it, expect } from "vitest";
import { searchChoices, addOffer, pickerSource, choiceLabel, RECENT_COUNT } from "../../public/js/search-choices.js";

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
      { id: "p1", name: "Sam", is_self: 0, default_role: "bottom", archived_at: null, created_at: "t1" },
      { id: "p2", name: "Me", is_self: 1, archived_at: null, created_at: "t2" },
      { id: "p3", name: "Alex", is_self: 0, archived_at: "2026-01-01T00:00:00Z", created_at: "t3" },
      { id: "pl", title: "Hip harness", archived_at: null, created_at: "t4" },
    ];
    expect(pickerSource(rows, ["p2"])).toEqual({
      active: [
        { id: "p1", name: "Sam", created_at: "t1", defaultRole: "bottom" },
        { id: "p2", name: "Me", label: "Me (you)", isSelf: true, created_at: "t2" },
        { id: "pl", name: "Hip harness", created_at: "t4" },
      ],
      archived: [{ id: "p3", name: "Alex", created_at: "t3" }],
      recent: ["p2"],
    });
  });

  it("marks the default location", () => {
    const rows = [
      { id: "l1", name: "Studio", is_default: 1, archived_at: null, created_at: "t1" },
      { id: "l2", name: "Park", is_default: 0, archived_at: null, created_at: "t2" },
    ];
    expect(pickerSource(rows, []).active).toEqual([
      { id: "l1", name: "Studio", created_at: "t1", isDefault: true },
      { id: "l2", name: "Park", created_at: "t2" },
    ]);
  });

  it("reads people's opened aliases", () => {
    const rows = [
      { id: "p1", name: "J", aliases: '[{"platform":"scene","alias":"therawkitty"}]', archived_at: null, created_at: "t1" },
      { id: "p2", name: "Sam", aliases: null, archived_at: null, created_at: "t2" },
    ];
    expect(pickerSource(rows, []).active).toEqual([
      { id: "p1", name: "J", created_at: "t1", aliases: [{ platform: "scene", alias: "therawkitty" }] },
      { id: "p2", name: "Sam", created_at: "t2" },
    ]);
  });
});

describe("people's aliases in the picker", () => {
  const j = { id: "j", name: "J", created_at: "t1", aliases: [/** @type {const} */ ({ platform: "scene", alias: "therawkitty" }), /** @type {const} */ ({ platform: "fetlife", alias: "knotty" })] };
  const sam = { id: "s", name: "Sam", created_at: "t2" };
  const me = { id: "m", name: "Me", label: "Me (you)", isSelf: true, created_at: "t0", aliases: [/** @type {const} */ ({ platform: "scene", alias: "dee" })] };

  it("finds a person by an alias as well as by name", () => {
    expect(ids(searchChoices([j, sam, me], [], "KNOT"))).toEqual(["j"]);
    expect(ids(searchChoices([j, sam, me], [], "dee"))).toEqual(["m"]);
    expect(ids(searchChoices([j, sam, me], [], "sa"))).toEqual(["s"]);
  });

  it("shows the alias that matched, or the scene name, or just the name; mine with (you)", () => {
    expect(choiceLabel(j, "knot")).toBe("J (knotty)");
    expect(choiceLabel(j, "j")).toBe("J (therawkitty)");
    expect(choiceLabel(j, "")).toBe("J (therawkitty)");
    expect(choiceLabel(sam, "sa")).toBe("Sam");
    expect(choiceLabel(me, "")).toBe("Me (dee) (you)");
    expect(choiceLabel({ id: "x", name: "Studio", created_at: "t" }, "")).toBe("Studio");
  });
});
