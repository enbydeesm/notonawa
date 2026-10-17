import { describe, it, expect } from "vitest";
import { DEFAULT_ORDER, nextOrder, orderList } from "../../public/js/list-order.js";

const people = [
  { id: "a", name: "sam", created_at: "2026-01-02T00:00:00Z" },
  { id: "b", name: "Me", created_at: "2026-01-01T00:00:00Z", is_self: 1 },
  { id: "c", name: "Alex", created_at: "2026-01-03T00:00:00Z" },
  { id: "d", name: "Öle", created_at: "2026-01-03T00:00:00Z" },
];
const names = (/** @type {{ name: string }[]} */ list) => list.map((p) => p.name);
const isMe = (/** @type {any} */ p) => !!p.is_self;

describe("nextOrder", () => {
  it("starts newest first, and tapping the chosen sort flips it", () => {
    expect(DEFAULT_ORDER).toEqual({ sort: "created", descending: true });
    expect(nextOrder(DEFAULT_ORDER, "created")).toEqual({ sort: "created", descending: false });
    expect(nextOrder({ sort: "name", descending: false }, "name")).toEqual({ sort: "name", descending: true });
  });

  it("switching starts A to Z, or newest first", () => {
    expect(nextOrder(DEFAULT_ORDER, "name")).toEqual({ sort: "name", descending: false });
    expect(nextOrder({ sort: "name", descending: true }, "created")).toEqual({ sort: "created", descending: true });
  });
});

describe("orderList", () => {
  it("sorts newest first, the same second A to Z", () => {
    expect(names(orderList(people, "", DEFAULT_ORDER))).toEqual(["Alex", "Öle", "sam", "Me"]);
    expect(names(orderList(people, "", { sort: "created", descending: false }))).toEqual(["Me", "sam", "Alex", "Öle"]);
  });

  it("sorts by name ignoring capitals, either way", () => {
    expect(names(orderList(people, "", { sort: "name", descending: false }))).toEqual(["Alex", "Me", "Öle", "sam"]);
    expect(names(orderList(people, "", { sort: "name", descending: true }))).toEqual(["sam", "Öle", "Me", "Alex"]);
  });

  it("keeps a pinned item at the top", () => {
    expect(names(orderList(people, "", { sort: "name", descending: true }, isMe))).toEqual(["Me", "sam", "Öle", "Alex"]);
    expect(names(orderList(people, "", DEFAULT_ORDER, isMe))).toEqual(["Me", "Alex", "Öle", "sam"]);
  });

  it("finds names containing the search, ignoring capitals and spaces around it", () => {
    expect(names(orderList(people, " A ", DEFAULT_ORDER, isMe))).toEqual(["Alex", "sam"]);
    expect(names(orderList(people, "ö", DEFAULT_ORDER))).toEqual(["Öle"]);
    expect(names(orderList(people, "me", DEFAULT_ORDER, isMe))).toEqual(["Me"]);
    expect(orderList(people, "zz", DEFAULT_ORDER)).toEqual([]);
  });

  it("leaves the list it's given as it was", () => {
    const copy = [...people];
    orderList(people, "", { sort: "name", descending: false });
    expect(people).toEqual(copy);
  });
});
