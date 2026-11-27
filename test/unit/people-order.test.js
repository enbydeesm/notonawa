// A card's people: "this is me" last, the rest as entered (people-order.js).
import { describe, it, expect } from "vitest";
import { selfLast } from "../../public/js/people-order.js";

describe("people on a card", () => {
  it("puts me last and keeps everyone else in the order entered", () => {
    const people = [{ name: "Me", is_self: 1 }, { name: "Zoe", is_self: 0 }, { name: "Al", is_self: 0 }];
    expect(selfLast(people).map((p) => p.name)).toEqual(["Zoe", "Al", "Me"]);
    expect(selfLast([{ name: "Zoe" }, { name: "Me", is_self: true }, { name: "Al" }]).map((p) => p.name)).toEqual(["Zoe", "Al", "Me"]);
    expect(selfLast([])).toEqual([]);
    // The list given is left as it was.
    expect(people.map((p) => p.name)).toEqual(["Me", "Zoe", "Al"]);
  });
});
