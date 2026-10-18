import { describe, it, expect } from "vitest";
import { parseImportItems, parseImportTies } from "../../src/data/import-parse.js";
import { planItems, planTies, jsonChunks, findByName, linksKey } from "../../src/data/import-plan.js";
import { sealed } from "../sealed.js";

/** Ids 1, 2, 3, … so plans are predictable. */
function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

const NONE = { people: [], locations: [], plans: [], tags: [] };

describe("parseImportItems", () => {
  it("parses people, locations, plans and tags as the app's forms do", () => {
    const items = parseImportItems({
      people: [{ id: "p1", name: "  Sam ", is_self: false, profile_notes: [{ type: "limit", description: sealed("No neck ties") }] }],
      locations: [{ id: "l1", name: "Studio", maps_url: "https://maps.example/x", latitude: "51.5" }],
      plans: [{ id: "a", title: "TK", version: 3, tags: ["box", "Box"] }, { id: "b", title: "TK 2", variation_of: "a" }],
      tags: ["floor", "", "Floor"],
    });
    expect(items.people[0]).toMatchObject({
      file_id: "p1", name: "Sam", is_self: 0, archived_at: null,
      profile_notes: [{ type: "limit", description: sealed("No neck ties"), is_current: 1, noted_on: null }],
    });
    expect(items.locations[0]).toMatchObject({ name: "Studio", maps_url: "https://maps.example/x", latitude: 51.5, longitude: null });
    expect(items.plans).toMatchObject([
      { file_id: "a", stage: "idea", version: 3, variation_of: null, tags: ["box"] },
      { file_id: "b", version: 1, variation_of: "a" },
    ]);
    expect(items.tags).toEqual(["floor"]);
    expect(parseImportItems({})).toEqual(NONE);
  });

  it("reads a plan's type and a default location, with files from before them as ideas and no default", () => {
    const items = parseImportItems({
      locations: [{ id: "l1", name: "Studio", is_default: true }, { id: "l2", name: "Park" }],
      plans: [{ id: "a", title: "TK", plan_type: "harness" }, { id: "b", title: "Old" }],
    });
    expect(items.locations.map((l) => l.is_default)).toEqual([1, 0]);
    expect(items.plans.map((p) => p.plan_type)).toEqual(["harness", "idea"]);
    expect(() => parseImportItems({ plans: [{ id: "c", title: "X", plan_type: "bogus" }] })).toThrow("Expected one of");
  });

  it("refuses notes and descriptions that aren't encrypted", () => {
    expect(() => parseImportItems({ people: [{ id: "1", name: "Sam", notes: "plain" }] })).toThrow("weren't encrypted");
    expect(() => parseImportItems({ people: [{ id: "1", name: "Sam", profile_notes: [{ type: "like", description: "plain" }] }] }))
      .toThrow("weren't encrypted");
    expect(() => parseImportTies({ ties: [{ tie_date: "2026-01-01", notes: "plain" }] })).toThrow("weren't encrypted");
    expect(() => parseImportTies({ ties: [{ tie_date: "2026-01-01", participants: [{ person_id: "p", role: "bottom", notes: "plain" }] }] }))
      .toThrow("weren't encrypted");
  });

  it("names the item in an error", () => {
    expect(() => parseImportItems({ people: [{ id: "1", name: "Sam" }, { id: "2", name: " " }] }))
      .toThrow("People 2: Give the person a name.");
    expect(() => parseImportItems({ locations: [{ id: "1", name: "Studio", latitude: 100 }] }))
      .toThrow('Locations 1 ("Studio"): Expected a number from -90 to 90.');
    expect(() => parseImportItems({ plans: [{ id: "1", title: "TK", archived_at: "yesterday" }] }))
      .toThrow('Plans 1 ("TK"): Expected a time like');
    expect(() => parseImportItems({ people: [{ id: "1", name: "Sam", profile_notes: [{ type: "mood", description: "x" }] }] }))
      .toThrow("Expected one of: injury");
  });

  it("refuses broken links and repeats within the file", () => {
    expect(() => parseImportItems({ plans: [{ id: "a", title: "TK", variation_of: "zzz" }] }))
      .toThrow('Plan "TK" is a variation of a plan that isn\'t in the file.');
    expect(() => parseImportItems({ plans: [{ id: "a", title: "TK", variation_of: "a" }] })).toThrow("variation of itself");
    expect(() => parseImportItems({ people: [{ id: "x", name: "A" }, { id: "x", name: "B" }] })).toThrow("used twice");
    expect(() => parseImportItems({ people: [{ id: "1", name: "A", is_self: true }, { id: "2", name: "B", is_self: true }] }))
      .toThrow("Only one person can be marked as you.");
    expect(() => parseImportItems({ people: [{ name: "No id" }] })).toThrow("needs an id");
    expect(() => parseImportItems({ people: "Sam" })).toThrow("People should be a list");
  });
});

describe("parseImportTies", () => {
  it("parses ties with ratings and notes on participants, and deleted links", () => {
    const [tie] = parseImportTies({ ties: [{
      title: "Floor", tie_date: "2026-10-12", duration_minutes: "45", location_id: null, location_deleted: true,
      participants: [
        { person_id: "p1", role: "bottom", difficulty_rating: 3, notes: sealed("good") },
        { person_id: "p1", role: "bottom" },
        { person_id: null, role: "spotter" },
      ],
      plans: [{ plan_id: "a", plan_version: 2 }, { plan_id: "a" }, { plan_id: null }],
      tags: ["floor", "FLOOR"],
    }] });
    expect(tie).toMatchObject({
      title: "Floor", duration_minutes: 45, location_deleted: 1, success_rating: null,
      participants: [
        { person_id: "p1", role: "bottom", difficulty_rating: 3, experience_rating: null, notes: sealed("good") },
        { person_id: null, role: "spotter" },
      ],
      plans: [{ plan_id: "a", plan_version: 2 }, { plan_id: null, plan_version: null }],
      tags: ["floor"],
    });
  });

  it("never marks a tie with a location as having lost it", () => {
    expect(parseImportTies({ ties: [{ title: "x", tie_date: "2026-01-01", location_id: "l1", location_deleted: true }] })[0].location_deleted).toBe(0);
  });

  it("names the tie in an error", () => {
    expect(() => parseImportTies({ ties: [{ title: "ok", tie_date: "2026-01-01" }, { title: "Undated" }] }))
      .toThrow('Tie 2 ("Undated"): Add a date.');
    expect(() => parseImportTies({ ties: [{ title: "Floor", tie_date: "12/10/2026" }] }))
      .toThrow('Tie 1 ("Floor"): Expected a date like 2026-10-12.');
    expect(() => parseImportTies({ ties: [{ title: "x", participants: [{ person_id: "p" }] }] })).toThrow("needs a role");
    expect(() => parseImportTies({ ties: new Array(501).fill({ title: "x" }) })).toThrow("up to 500");
    expect(() => parseImportTies({})).toThrow("up to 500");
  });
});

describe("planItems: the default location", () => {
  const file = (/** @type {Record<string, unknown>[]} */ locations) => parseImportItems({ locations });
  const mine = { people: [], plans: [], tags: [] };

  it("keeps the file's default when I have none and it's new and not archived", () => {
    const plan = planItems(file([{ id: "a", name: "Park" }, { id: "b", name: "Studio", is_default: true }]), { ...mine, locations: [] }, counter());
    expect(plan.rows.locations.map((l) => [l.name, l.is_default])).toEqual([["Park", 0], ["Studio", 1]]);
  });

  it("drops it when I already have a default, or it's archived, or matched to one of mine", () => {
    const withDefault = { ...mine, locations: [{ id: "home", name: "Home", is_default: 1, archived_at: null }] };
    expect(planItems(file([{ id: "b", name: "Studio", is_default: true }]), withDefault, counter()).rows.locations[0].is_default).toBe(0);
    const archived = file([{ id: "b", name: "Studio", is_default: true, archived_at: "2026-01-01T00:00:00Z" }]);
    expect(planItems(archived, { ...mine, locations: [] }, counter()).rows.locations[0].is_default).toBe(0);
    const matched = planItems(file([{ id: "b", name: "Studio", is_default: true }]), { ...mine, locations: [{ id: "s", name: "studio", archived_at: null }] }, counter());
    expect(matched.rows.locations).toEqual([]);
  });
});

describe("planItems", () => {
  const existing = {
    people: [
      { id: "me", name: "Jo", is_self: 1, archived_at: null },
      { id: "sam-old", name: "Sam", is_self: 0, archived_at: "2026-01-01T00:00:00Z" },
      { id: "sam", name: "sam", is_self: 0, archived_at: null },
    ],
    locations: [{ id: "studio", name: "Studio", archived_at: null }],
    plans: [{ id: "tk", name: "TK", archived_at: null }],
    tags: [{ id: "t1", name: "Floor" }],
  };

  it("matches by name, my own profile by is_self, and creates the rest", () => {
    const items = parseImportItems({
      people: [
        { id: "f-me", name: "Me", is_self: true, notes: sealed("ignored: matched") },
        { id: "f-sam", name: "SAM" },
        { id: "f-alex", name: "Alex", profile_notes: [{ type: "like", description: sealed("Hip harness") }] },
      ],
      locations: [{ id: "f-studio", name: "studio" }, { id: "f-park", name: "Park", archived_at: "2026-02-02T00:00:00Z" }],
      plans: [{ id: "f-tk", title: "TK", tags: ["ignored"] }, { id: "f-v", title: "TK v2", variation_of: "f-tk", tags: ["floor", "Rope"] }],
      tags: ["spare"],
    });
    const plan = planItems(items, existing, counter());

    // Active before archived; "Sam" archived vs "sam" active: the active one wins.
    expect(plan.people).toEqual([
      { file_id: "f-me", name: "Me", id: "me", matched: true },
      { file_id: "f-sam", name: "SAM", id: "sam", matched: true },
      { file_id: "f-alex", name: "Alex", id: "new-1", matched: false },
    ]);
    expect(plan.locations.map((l) => [l.id, l.matched])).toEqual([["studio", true], ["new-2", false]]);
    expect(plan.plans.map((p) => [p.id, p.matched])).toEqual([["tk", true], ["new-3", false]]);
    expect(plan.newTags).toEqual(["spare", "Rope"]);

    expect(plan.rows.people).toEqual([expect.objectContaining({ id: "new-1", name: "Alex", is_self: 0 })]);
    expect(plan.rows.profileNotes).toEqual([expect.objectContaining({ person_id: "new-1", type: "like", description: sealed("Hip harness") })]);
    expect(plan.rows.locations).toEqual([expect.objectContaining({ id: "new-2", archived_at: "2026-02-02T00:00:00Z" })]);
    expect(plan.rows.plans).toEqual([expect.objectContaining({ id: "new-3", title: "TK v2" })]);
    // A variation of a matched plan points at the existing plan.
    expect(plan.rows.variations).toEqual([{ id: "new-3", variation_of: "tk" }]);
    // Tags use my spelling where I have the tag; the matched plan's tags are left alone.
    expect(plan.rows.planTags).toEqual([{ plan_id: "new-3", name: "Floor" }, { plan_id: "new-3", name: "Rope" }]);
  });

  it("keeps the file's 'this is me' when I don't have one", () => {
    const items = parseImportItems({ people: [{ id: "x", name: "Me", is_self: true }] });
    const plan = planItems(items, { ...NONE, people: [] }, counter());
    expect(plan.rows.people[0]).toMatchObject({ is_self: 1 });
  });

  it("creates everything in an empty journal", () => {
    const items = parseImportItems({ people: [{ id: "a", name: "Sam" }, { id: "b", name: "Sam" }] });
    const plan = planItems(items, NONE, counter());
    // Two people with the same name in the file stay two people.
    expect(plan.rows.people.map((p) => p.id)).toEqual(["new-1", "new-2"]);
  });
});

describe("linksKey", () => {
  it("lists people with roles, plans and tags, in any order", () => {
    const key = linksKey([{ person_id: "b", role: "bottom" }, { person_id: "a", role: "top" }], ["p2", "p1"], ["t2", "t1"]);
    expect(key).toBe("a|top,b|bottom;p1,p2;t1,t2");
    expect(linksKey([{ person_id: "a", role: "top" }, { person_id: "b", role: "bottom" }], ["p1", "p2"], ["t1", "t2"])).toBe(key);
  });

  it("keeps deleted people and plans as empty entries, and is empty with no links", () => {
    expect(linksKey([{ person_id: null, role: "bottom" }], [null], [])).toBe("|bottom;;");
    expect(linksKey([], [], [])).toBe(";;");
  });
});

describe("planTies", () => {
  it("gives each tie and link a new id, and resolves tags to my spelling", () => {
    const ties = parseImportTies({ ties: [
      { title: "A", tie_date: "2026-01-01", participants: [{ person_id: "p", role: "bottom" }], plans: [{ plan_id: "pl" }], tags: ["floor", "New"] },
      { title: "B", tie_date: "2026-01-02", tags: ["new"] },
    ] });
    const plan = planTies(ties, [{ id: "t", name: "Floor" }], counter());
    expect(plan.newTags).toEqual(["New"]);
    expect(plan.rows.tags).toEqual([{ id: "new-1", name: "New" }]);
    expect(plan.rows.ties.map((t) => t.id)).toEqual(["new-2", "new-3"]);
    // Tags in the links key are ids: "t" is mine, "new-1" is being added.
    expect(plan.rows.ties.map((t) => t.links)).toEqual(["p|bottom;pl;new-1,t", ";;new-1"]);
    expect(plan.rows.participants).toEqual([expect.objectContaining({ id: "new-4", tie_id: "new-2", person_id: "p", role: "bottom" })]);
    expect(plan.rows.tiePlans).toEqual([{ id: "new-5", tie_id: "new-2", plan_id: "pl", plan_version: null }]);
    expect(plan.rows.tieTags).toEqual([
      { tie_id: "new-2", name: "Floor" }, { tie_id: "new-2", name: "New" }, { tie_id: "new-3", name: "New" },
    ]);
  });
});

describe("jsonChunks", () => {
  it("splits rows into JSON arrays under the size limit", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ i, text: "x".repeat(20) }));
    const chunks = jsonChunks(rows, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.flatMap((c) => JSON.parse(c))).toEqual(rows);
    expect(jsonChunks([])).toEqual([]);
    expect(jsonChunks(rows)).toHaveLength(1);
  });
});

describe("findByName", () => {
  it("prefers the exact spelling, then ignores capitals", () => {
    const items = [{ id: "1", name: "sam", archived_at: null }, { id: "2", name: "Sam", archived_at: null }];
    expect(findByName(items, "Sam")?.id).toBe("2");
    expect(findByName(items, "SAM")?.id).toBe("1");
    expect(findByName(items, "Alex")).toBeUndefined();
  });
});
