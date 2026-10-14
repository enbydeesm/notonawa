import { describe, it, expect } from "vitest";
import { exportDocument, exportFileName } from "../../src/data/shape.js";

/** @type {import("../../src/data/shape.js").AccountRows} */
const EMPTY = {
  user: { created_at: "2026-01-01T00:00:00Z", accepted_at: "2026-01-01T00:00:00Z", terms_version: "1" },
  passkeys: [], people: [], profileNotes: [], locations: [], plans: [], planTags: [], tags: [],
  ties: [], participants: [], tiePlans: [], tieTags: [],
};

describe("exportDocument", () => {
  it("labels the file with its format, version and time", () => {
    expect(exportDocument(EMPTY, "2026-10-13T10:00:00Z")).toMatchObject({
      format: "rope-journal-export", version: 1, exported_at: "2026-10-13T10:00:00Z",
      account: { created_at: "2026-01-01T00:00:00Z", terms_version: "1", passkeys: [] },
      people: [], locations: [], plans: [], tags: [], ties: [],
    });
  });

  it("nests each tie's participants, plans and tags, and turns flags into true/false", () => {
    const doc = exportDocument({
      ...EMPTY,
      ties: [
        { id: "t1", title: "A", location_id: null, location_deleted: 1 },
        { id: "t2", title: "B", location_id: "l1", location_deleted: 0 },
      ],
      participants: [
        { tie_id: "t1", person_id: null, role: "model", difficulty_rating: 3, experience_rating: null, notes: "n" },
        { tie_id: "t2", person_id: "p1", role: "rigger", difficulty_rating: null, experience_rating: 4, notes: null },
      ],
      tiePlans: [{ tie_id: "t1", plan_id: "pl1", plan_version: 2 }],
      tieTags: [{ tie_id: "t2", name: "floor" }, { tie_id: "t2", name: "Futomomo" }],
    }, "2026-10-13T10:00:00Z");

    expect(doc.ties[0]).toMatchObject({
      id: "t1", location_deleted: true,
      participants: [{ person_id: null, role: "model", difficulty_rating: 3, experience_rating: null, notes: "n" }],
      plans: [{ plan_id: "pl1", plan_version: 2 }], tags: [], photos: [],
    });
    expect(doc.ties[1]).toMatchObject({
      id: "t2", location_id: "l1", location_deleted: false,
      participants: [{ person_id: "p1", role: "rigger" }], plans: [], tags: ["floor", "Futomomo"],
    });
  });

  it("nests profile notes under people and tags under plans", () => {
    const doc = exportDocument({
      ...EMPTY,
      people: [{ id: "p1", name: "Sam", is_self: 0 }, { id: "p2", name: "Me", is_self: 1 }],
      profileNotes: [{ person_id: "p1", type: "limit", description: "No neck ties", noted_on: null, is_current: 1 }],
      plans: [{ id: "pl1", title: "TK" }],
      planTags: [{ plan_id: "pl1", name: "box tie" }],
    }, "2026-10-13T10:00:00Z");
    expect(doc.people[0]).toMatchObject({
      is_self: false, profile_notes: [{ type: "limit", description: "No neck ties", is_current: true }],
    });
    expect(doc.people[1]).toMatchObject({ is_self: true, profile_notes: [] });
    expect(doc.plans[0]).toMatchObject({ tags: ["box tie"], photos: [] });
  });

  it("lists passkeys by name and dates only", () => {
    const doc = exportDocument({
      ...EMPTY,
      passkeys: [{ name: "Phone", created_at: "a", last_used_at: "b", public_key: "secret-ish" }],
    }, "2026-10-13T10:00:00Z");
    expect(doc.account.passkeys).toEqual([{ name: "Phone", created_at: "a", last_used_at: "b" }]);
  });
});

describe("exportFileName", () => {
  it("names the file after the day", () => {
    expect(exportFileName("2026-10-13T23:59:00Z")).toBe("rope-journal-2026-10-13.json");
  });
});
