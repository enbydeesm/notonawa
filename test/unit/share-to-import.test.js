import { describe, it, expect } from "vitest";
import { shareToImport, addsItems, withKnown, duplicatePlan, SHARED_PLAN } from "../../public/js/share-to-import.js";
import { readItemShare } from "../../public/js/share-item.js";
import { remapTies, remapWorkshops } from "../../public/js/import-steps.js";

const TIE = /** @type {import("../../public/js/share-item.js").SharedItem} */ (readItemShare("tie", {
  v: 1, tie_date: "2026-10-12", tie_type: "floor", title: "Hip harness", notes: "Went well", tags: ["floor"],
  location: { name: "Studio", city: "Seattle" }, plans: ["TK", "Box"],
  people: [{ name: "Jude", role: "top", sender: true }, { name: "Alex", role: "bottom" }, { name: "Sam", role: "spotter" }],
}));

describe("shareToImport", () => {
  it("sends only what's new (never matched by name), and fills in what I chose from my journal", () => {
    const { doc, known } = shareToImport("tie", TIE, {
      people: [{ type: "person", id: "jude" }, { type: "me" }, { type: "new", name: " Sam B " }],
      location: { type: "new", name: "Studio" },
      plans: [{ type: "existing", id: "tk" }, { type: "new", name: "Box" }],
    }, "self");
    expect(doc.people).toEqual([{ id: "person-2", name: "Sam B", match: false }]);
    expect(doc.locations).toEqual([{ id: "location", name: "Studio", city: "Seattle", state_province: null, country: null, match: false }]);
    expect(doc.plans).toEqual([{ id: "plan-1", title: "Box", match: false }]);
    expect(known).toEqual({
      people: [{ file_id: "person-0", id: "jude" }, { file_id: "person-1", id: "self" }],
      locations: [], plans: [{ file_id: "plan-0", id: "tk" }],
    });
    expect(doc.ties).toEqual([expect.objectContaining({
      title: "Hip harness", tie_date: "2026-10-12", tie_type: "floor", notes: "Went well", location_id: "location", tags: ["floor"],
      participants: [{ person_id: "person-0", role: "top" }, { person_id: "person-1", role: "bottom" }, { person_id: "person-2", role: "spotter" }],
      plans: [{ plan_id: "plan-0" }, { plan_id: "plan-1" }],
    })]);
    expect(addsItems(doc)).toBe(true);

    // What the server answers for the new ones, with mine added: every link swaps.
    const items = withKnown({
      people: [{ file_id: "person-2", name: "Sam B", id: "sam", matched: false }],
      locations: [{ file_id: "location", name: "Studio", id: "studio", matched: false }],
      plans: [{ file_id: "plan-1", name: "Box", id: "box", matched: false }],
    }, known);
    const [tie] = remapTies(doc.ties, items);
    expect([tie.location_id, tie.participants.map((/** @type {any} */ p) => p.person_id), tie.plans.map((/** @type {any} */ p) => p.plan_id)])
      .toEqual(["studio", ["jude", "self", "sam"], ["tk", "box"]]);
  });

  it("adds nothing when everything is chosen from my journal", () => {
    const { doc } = shareToImport("tie", TIE, {
      people: [{ type: "me" }, { type: "person", id: "a" }, { type: "person", id: "s" }],
      location: { type: "existing", id: "studio" }, plans: [{ type: "existing", id: "tk" }, { type: "existing", id: "box" }],
    }, "self");
    expect(addsItems(doc)).toBe(false);
  });

  it("splits a workshop's people into educators and participants, keeping its cost and event link", () => {
    const workshop = /** @type {any} */ (readItemShare("workshop", {
      v: 1, title: "W", start_date: "2026-10-01", people: [{ name: "Alex", role: "top", kind: "educator" }, { name: "Jude", role: "bottom" }],
      cost: "GBP 60.00", event_url: "https://example.com/w",
    }));
    const { doc, known } = shareToImport("workshop", workshop, { people: [{ type: "new", name: "Alex" }, { type: "me" }], location: null, plans: [] }, "self");
    const [w] = remapWorkshops(doc.workshops, withKnown({ people: [{ file_id: "person-0", name: "Alex", id: "alex", matched: false }], locations: [], plans: [] }, known));
    expect([w.educators, w.participants, w.location_id]).toEqual([[{ person_id: "alex", role: "top" }], [{ person_id: "self", role: "bottom" }], null]);
    // Its cost and event link come too (sealed with the rest when it's added).
    expect([w.cost, w.event_url]).toEqual(["GBP 60.00", "https://example.com/w"]);
  });

  it("sends a shared plan as one new plan", () => {
    const plan = /** @type {any} */ (readItemShare("plan", { v: 1, title: "TK", plan_type: "harness", description: "Box", tags: ["a"] }));
    const { doc } = shareToImport("plan", plan, { people: [], location: null, plans: [] }, "self");
    expect(doc.plans).toEqual([{
      id: SHARED_PLAN, title: "TK", plan_type: "harness", tie_type: null, est_difficulty: null, description: "Box", notes: null,
      album_url: null, tags: ["a"], match: false,
    }]);
    expect(doc.ties).toEqual([]);
  });
});

describe("duplicatePlan", () => {
  const plan = /** @type {any} */ (readItemShare("plan", { v: 1, title: "TK", description: "Box" }));

  it("finds one of mine with the same title (ignoring capitals), description and notes", () => {
    expect(duplicatePlan(plan, [{ id: "a", title: "tk", description: "Other" }, { id: "b", title: "Tk", description: "Box", notes: null }])).toBe("b");
    expect(duplicatePlan(plan, [{ id: "a", title: "TK", description: "Box", notes: "mine" }])).toBeNull();
  });
});
