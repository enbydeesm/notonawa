import { describe, it, expect } from "vitest";
import {
  listChoices, offerNew, newKinds, titleMatches, itemOf, kindName, newEntryText, SHOWN,
} from "../../public/js/add-to-choices.js";

/** @typedef {import("../../public/js/add-to-choices.js").Target} Target */

/**
 * @param {Target["kind"]} kind @param {string} id @param {string} title @param {string} [recent]
 * @returns {Target}
 */
const target = (kind, id, title, recent = "") => ({ kind, id, title, meta: "", recent });

const futo = target("tie", "t1", "Futomomo variations", "2026-10-30T10:00:00Z");
const box = target("tie", "t2", "Box tie, single column", "2026-10-01T10:00:00Z");
const saturday = target("plan", "p1", "Saturday session", "2026-10-29T10:00:00Z");
const intro = target("workshop", "w1", "Intro to suspension", "2026-10-31T10:00:00Z");
const all = [futo, box, saturday, intro];
const ids = (/** @type {Target[]} */ list) => list.map((t) => t.id);

describe("listChoices", () => {
  it("lists every kind together, most recently changed first", () => {
    expect(ids(listChoices({ targets: all, query: "", filter: "all", last: null }))).toEqual(["w1", "t1", "p1", "t2"]);
  });

  it("puts the one chosen last first, whatever its date", () => {
    expect(ids(listChoices({ targets: all, query: "", filter: "all", last: { kind: "tie", id: "t2" } }))).toEqual(["t2", "w1", "t1", "p1"]);
  });

  it("doesn't mistake another kind with the same id for the one chosen last", () => {
    const sameId = target("plan", "t2", "A plan", "2026-01-01T00:00:00Z");
    expect(ids(listChoices({ targets: [...all, sameId], query: "", filter: "all", last: { kind: "tie", id: "t2" } }))[0]).toBe("t2");
    expect(listChoices({ targets: [...all, sameId], query: "", filter: "all", last: { kind: "tie", id: "t2" } })[0].kind).toBe("tie");
  });

  it("shows only one kind with a chip, the one chosen last still first if it's that kind", () => {
    expect(ids(listChoices({ targets: all, query: "", filter: "tie", last: { kind: "tie", id: "t2" } }))).toEqual(["t2", "t1"]);
    expect(ids(listChoices({ targets: all, query: "", filter: "plan", last: { kind: "tie", id: "t2" } }))).toEqual(["p1"]);
  });

  it("finds titles with every word typed, in any order and any case", () => {
    expect(ids(listChoices({ targets: all, query: "TIE box", filter: "all", last: null }))).toEqual(["t2"]);
    expect(ids(listChoices({ targets: all, query: "io", filter: "all", last: null }))).toEqual(["w1", "t1", "p1"]);
  });

  it("keeps ties the device's search found, though their titles don't have the words (it searches notes too)", () => {
    expect(ids(listChoices({ targets: all, query: "hip", filter: "all", last: null }, new Set(["t1"])))).toEqual(["t1"]);
  });

  it("shows at most SHOWN", () => {
    const many = Array.from({ length: SHOWN + 5 }, (_, i) => target("plan", `p${i}`, `Plan ${i}`));
    expect(listChoices({ targets: many, query: "", filter: "all", last: null })).toHaveLength(SHOWN);
  });

  it("keeps the order they came in when nothing else tells them apart", () => {
    const a = target("plan", "a", "A"), b = target("plan", "b", "B");
    expect(ids(listChoices({ targets: [a, b], query: "", filter: "all", last: null }))).toEqual(["a", "b"]);
  });
});

describe("offerNew", () => {
  it("offers a new one when something's typed that nothing has as its title", () => {
    expect(offerNew(all, "hip harness", "all")).toBe(true);
    expect(offerNew(all, "", "all")).toBe(false);
    expect(offerNew(all, "   ", "all")).toBe(false);
  });

  it("doesn't when one has exactly that title, ignoring case and spaces", () => {
    expect(offerNew(all, "  saturday SESSION ", "all")).toBe(false);
  });

  it("only counts the kinds shown", () => {
    expect(offerNew(all, "Saturday session", "tie")).toBe(true);
  });
});

describe("the rest", () => {
  it("newKinds: all three, or the one filtered to", () => {
    expect(newKinds("all")).toEqual(["tie", "plan", "workshop"]);
    expect(newKinds("workshop")).toEqual(["workshop"]);
    // Linking to a workshop: ties and plans only.
    expect(newKinds("all", ["tie", "plan"])).toEqual(["tie", "plan"]);
    expect(newKinds("plan", ["tie", "plan"])).toEqual(["plan"]);
  });

  it("titleMatches needs every word", () => {
    expect(titleMatches("Hip harness to futomomo", "futo hip")).toBe(true);
    expect(titleMatches("Hip harness to futomomo", "futo chest")).toBe(false);
    expect(titleMatches("Anything", "")).toBe(true);
  });

  it("itemOf names the item as the API does", () => {
    expect(itemOf({ kind: "tie", id: "x" })).toEqual({ tie_id: "x" });
    expect(itemOf({ kind: "plan", id: "x" })).toEqual({ plan_id: "x" });
    expect(itemOf({ kind: "workshop", id: "x" })).toEqual({ workshop_id: "x" });
    expect(kindName("workshop")).toBe("Workshop");
  });

  it("newEntryText says what isn't saved", () => {
    expect(newEntryText("tie", "pose")).toEqual({
      bar: "Not saved yet. Save this tie to keep the pose.",
      discard: { title: "Discard this new tie?", message: "The pose is only on this form until you save it.", label: "Discard tie" },
    });
    expect(newEntryText("workshop", "picture").bar).toBe("Not saved yet. Save this workshop to keep the picture of the pose.");
  });
});
