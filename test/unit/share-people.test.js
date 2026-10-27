import { describe, it, expect } from "vitest";
import { suggestPeople, peopleProblem, suggestItem, plansProblem } from "../../public/js/share-people.js";

const MINE = [
  { id: "me", name: "Jude", is_self: 1, connection_id: null },
  { id: "alex", name: "Alex", connection_id: null },
  { id: "rin", name: "Rin K", connection_id: "c1" },
];

describe("suggestPeople", () => {
  it("suggests the card linked to the sender, then names that match (Me included), then new", () => {
    const shared = [
      { name: "Rin", role: "top", sender: /** @type {const} */ (true) },
      { name: " alex ", role: "bottom" },
      { name: "JUDE", role: "spotter" },
      { name: "Sam", role: "photographer" },
    ];
    expect(suggestPeople("tie", shared, MINE, "c1")).toEqual([
      { type: "person", id: "rin" }, { type: "person", id: "alex" }, { type: "me" }, { type: "new", name: "Sam" },
    ]);
    // Not connected: the sender is matched by name like anyone else.
    expect(suggestPeople("tie", shared, MINE, null)[0]).toEqual({ type: "new", name: "Rin" });
  });

  it("doesn't suggest the same person twice: someone is on an item once", () => {
    const shared = [{ name: "Alex", role: "top" }, { name: "Alex", role: "spotter" }];
    expect(suggestPeople("tie", shared, MINE, null)).toEqual([{ type: "person", id: "alex" }, { type: "new", name: "Alex" }]);
  });
});

describe("peopleProblem", () => {
  const shared = [{ name: "Rin", role: "top" }, { name: "Alex", role: "bottom" }];

  it("allows different people, and new ones with names", () => {
    expect(peopleProblem("tie", shared, [{ type: "me" }, { type: "new", name: "Alex" }], "me")).toBeNull();
  });

  it("refuses Me twice (counting my own card picked by id), the same person twice, or a new person without a name", () => {
    expect(peopleProblem("workshop", shared, [{ type: "me" }, { type: "person", id: "me" }], "me"))
      .toBe("Rin and Alex can't both be you: someone is on a workshop once.");
    expect(peopleProblem("tie", shared, [{ type: "person", id: "alex" }, { type: "person", id: "alex" }], "me"))
      .toBe("Rin and Alex can't both be the same person: someone is on a tie once.");
    expect(peopleProblem("tie", shared, [{ type: "me" }, { type: "new", name: " " }], "me")).toContain("Type a name");
  });
});

describe("suggestItem and plansProblem", () => {
  const plans = [{ id: "tk", name: "TK" }, { id: "hh", name: "Hip harness" }];

  it("suggests mine with the same name, or a new one", () => {
    expect(suggestItem("tk", plans)).toEqual({ type: "existing", id: "tk" });
    expect(suggestItem("Box", plans)).toEqual({ type: "new", name: "Box" });
  });

  it("refuses two shared plans as the same one of mine", () => {
    expect(plansProblem(["TK", "TK2"], [{ type: "existing", id: "tk" }, { type: "existing", id: "tk" }]))
      .toBe("TK and TK2 can't both be the same plan.");
    expect(plansProblem(["TK", "TK2"], [{ type: "existing", id: "tk" }, { type: "new", name: "TK2" }])).toBeNull();
  });
});
