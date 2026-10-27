import { describe, it, expect } from "vitest";
import { itemSource, buildItemShare, readItemShare, hasField, FIELDS, LIMITS, SHARE_LEGEND } from "../../public/js/share-item.js";

// A tie as its form has it (GET /api/ties/:id, opened).
const TIE = {
  id: "t1", title: "Hip harness", tie_date: "2026-10-12", tie_type: "floor", duration_minutes: 45, success_rating: 4,
  notes: "Went well", album_url: "https://photos.app.goo.gl/x", location_id: "l1", location_name: "Studio", photo_count: 2,
  participants: [
    { person_id: "me", person_name: "Me", role: "top" },
    { person_id: "p2", person_name: "Alex", role: "bottom" },
    { person_id: null, person_name: null, role: "spotter" },
  ],
  plans: [{ plan_id: "pl1", plan_title: "TK" }, { plan_id: null, plan_title: null }],
  tags: ["floor", "practice"],
};
const LOCATION = { id: "l1", name: "Studio", city: "Seattle", state_province: "WA", country: null, notes: "door code 1234" };
/** @type {import("../../public/js/share-item.js").SharedVisual[]} */
const VISUALS = [{ kind: "pose", data: { v: 1, joints: {} }, caption: "Start" }, { kind: "drawing", data: { v: 1, strokes: [] }, caption: null }];
const EXTRAS = { selfId: "me", myName: " Jude ", location: LOCATION, visuals: VISUALS };
const ALL = (/** @type {"tie" | "plan" | "workshop"} */ kind) => FIELDS[kind].map((f) => f.key);

describe("itemSource and buildItemShare", () => {
  it("shares a tie's ticked fields, with me under the name I typed and deleted links left out", () => {
    const source = itemSource("tie", TIE, EXTRAS);
    expect(buildItemShare("tie", source, ALL("tie"))).toEqual({
      v: 1, tie_date: "2026-10-12", tie_type: "floor", title: "Hip harness", duration_minutes: 45,
      location: { name: "Studio", city: "Seattle", state_province: "WA", country: null }, plans: ["TK"],
      people: [{ name: "Jude", role: "top", sender: true }, { name: "Alex", role: "bottom" }], success_rating: 4,
      notes: "Went well", album_url: "https://photos.app.goo.gl/x", visuals: VISUALS, tags: ["floor", "practice"],
    });
    // Never a location's notes, or anyone's ids.
    const text = JSON.stringify(buildItemShare("tie", source, ALL("tie")));
    expect(text).not.toContain("door code");
    expect(text).not.toContain("p2");
  });

  it("always shares a tie's date and type, and leaves out what wasn't ticked or is empty", () => {
    const source = itemSource("tie", { ...TIE, title: null, notes: "" }, { ...EXTRAS, location: null, visuals: [] });
    expect(buildItemShare("tie", source, ["title", "notes", "people", "bogus"])).toEqual({
      v: 1, tie_date: "2026-10-12", tie_type: "floor",
      people: [{ name: "Jude", role: "top", sender: true }, { name: "Alex", role: "bottom" }],
    });
    expect(hasField(source, "location")).toBe(false);
    expect(hasField(source, "people")).toBe(true);
  });

  it("needs a name for me when people are shared, and a title for a plan", () => {
    const source = itemSource("tie", TIE, { ...EXTRAS, myName: "" });
    expect(() => buildItemShare("tie", source, ["people"])).toThrow("name to show for you");
    expect(buildItemShare("tie", source, ["title"]).people).toBeUndefined();
    expect(() => buildItemShare("plan", itemSource("plan", { id: "x" }, EXTRAS), [])).toThrow("Add a title");
  });

  it("shares a workshop's educators and participants with their kinds, and its dates", () => {
    const workshop = {
      id: "w1", title: "Suspension intensive", start_date: "2026-10-01", end_date: "2026-10-03", rating: 5, attendee_count: 12,
      educators: [{ person_id: "p2", person_name: "Alex", role: "top" }],
      participants: [{ person_id: "me", person_name: "Me", role: "bottom" }],
      tags: [], description: "Two days", location_id: null,
    };
    expect(buildItemShare("workshop", itemSource("workshop", workshop, { ...EXTRAS, location: null }), ["people", "rating"])).toEqual({
      v: 1, title: "Suspension intensive", start_date: "2026-10-01", end_date: "2026-10-03", rating: 5,
      people: [{ name: "Alex", role: "top", kind: "educator" }, { name: "Jude", role: "bottom", kind: "participant", sender: true }],
    });
  });
});

describe("readItemShare", () => {
  it("reads what buildItemShare makes", () => {
    const snapshot = buildItemShare("tie", itemSource("tie", TIE, EXTRAS), ALL("tie"));
    const read = readItemShare("tie", JSON.parse(JSON.stringify(snapshot)));
    const { v: _v, ...fields } = snapshot;
    expect(read).toMatchObject({ ...fields, description: null, start_date: null });
    const plan = { id: "p", title: "TK", plan_type: "harness", tie_type: "floor", est_difficulty: 3, description: "Box", notes: "n", tags: ["a"] };
    expect(readItemShare("plan", buildItemShare("plan", itemSource("plan", plan, EXTRAS), ALL("plan"))))
      .toMatchObject({ title: "TK", plan_type: "harness", tie_type: "floor", est_difficulty: 3, description: "Box", tags: ["a"] });
  });

  it("isn't fooled by what another account could send", () => {
    for (const bad of [null, "tie", [], { v: 2, tie_date: "2026-01-01", tie_type: "floor" }, { v: 1, tie_type: "floor" },
      { v: 1, tie_date: "2026-02-30", tie_type: "floor" }, { v: 1, tie_date: "2026-01-01", tie_type: "bogus" }]) {
      expect(readItemShare("tie", bad)).toBeNull();
    }
    expect(readItemShare("plan", { v: 1, title: " " })).toBeNull();
    expect(readItemShare("workshop", { v: 1, title: "W" })).toBeNull();
    expect(readItemShare(/** @type {any} */ ("profile"), { v: 1, title: "W" })).toBeNull();

    const read = readItemShare("tie", {
      v: 1, tie_date: "2026-01-01", tie_type: "floor", title: "x".repeat(LIMITS.title + 1), success_rating: 9, duration_minutes: -1,
      album_url: "javascript:alert(1)", notes: 5, description: "ties have none", extra: "dropped",
      location: { name: "", city: "Seattle" },
      people: [{ name: "Ok", role: "top", sender: "yes" }, { name: "No role", role: "rigger" }, { name: "", role: "top" }, "Sam"],
      plans: ["TK", "tk", 3, ""], tags: ["a", "A", "x".repeat(41)],
      visuals: [{ kind: "drawing", data: { v: 1 } }, { kind: "photo", data: {} }, { kind: "pose", data: [] },
        { kind: "pose", data: { v: 1 }, caption: 7 }],
    });
    expect(read).toMatchObject({
      title: null, success_rating: null, duration_minutes: null, album_url: null, notes: null, description: null, location: null,
      people: [{ name: "Ok", role: "top" }], plans: ["TK"], tags: ["a"], visuals: [{ kind: "pose", data: { v: 1 }, caption: null }],
    });
    expect(read).not.toHaveProperty("extra");
    expect(read?.people[0]).not.toHaveProperty("sender");
  });

  it("keeps lists to what an item can hold, and a workshop's end only after its start", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `P${i}`, role: "top" }));
    const drawings = Array.from({ length: 25 }, () => ({ kind: "drawing", data: { v: 1, strokes: [] }, caption: null }));
    const read = readItemShare("workshop", {
      v: 1, title: "W", start_date: "2026-01-02", end_date: "2026-01-01", people: many, visuals: drawings,
    });
    expect([read?.people.length, read?.visuals.length, read?.end_date]).toEqual([LIMITS.people, 20, null]);
    expect(read?.people[0].kind).toBe("participant");
  });
});

describe("SHARE_LEGEND", () => {
  it("names what's always shared over the tickboxes, and none of the tickboxes' own fields", () => {
    expect(SHARE_LEGEND).toEqual({
      tie: "Share date and type and…", plan: "Share title and…", workshop: "Share title and dates and…",
    });
    for (const kind of /** @type {const} */ (["tie", "plan", "workshop"])) {
      const words = SHARE_LEGEND[kind].toLowerCase().split(/[^a-z]+/);
      for (const field of FIELDS[kind]) expect(words).not.toContain(field.label.toLowerCase());
    }
  });
});
