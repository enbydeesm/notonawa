// Format 2 edits (public/js/records/edits.js, parse.js): what the People and
// Locations forms make of a record, and the rules across records the
// database kept for format 1.
import { describe, it, expect } from "vitest";
import {
  personBody, locationBody, clearOtherDefaults, archived, restored, personDeleted, locationDeleted, SELF_KEPT, ARCHIVED_DEFAULT,
} from "../../public/js/records/edits.js";
import { roleOrNull, dateOrNull, urlOrNull, numberOrNull, flag, compact } from "../../public/js/records/parse.js";
import { recordProblems } from "../../public/js/records/schema.js";

const NOW = "2026-11-14T12:00:00Z";
const LATER = "2026-11-15T09:00:00Z";

describe("field parsers", () => {
  it("read as the server's do", () => {
    expect([roleOrNull("rigger"), roleOrNull("model"), roleOrNull(""), roleOrNull("self tie")]).toEqual(["top", "bottom", null, "self tie"]);
    expect(() => roleOrNull("Top")).toThrow(/Expected one of/);
    expect(dateOrNull("2026-02-28")).toBe("2026-02-28");
    expect(() => dateOrNull("2026-02-30")).toThrow(/date like/);
    expect(urlOrNull(" https://example.com/a ")).toBe("https://example.com/a");
    expect(() => urlOrNull("javascript:alert(1)")).toThrow(/https/);
    expect([numberOrNull("", 0, 1), numberOrNull("0.5", 0, 1)]).toEqual([null, 0.5]);
    expect(() => numberOrNull("2", 0, 1)).toThrow(/from 0 to 1/);
    expect([true, "on", "1", 1, "true"].map(flag)).toEqual([true, true, true, true, true]);
    expect([false, "", "0", undefined].map(flag)).toEqual([false, false, false, false]);
    expect(compact({ a: null, b: undefined, c: false, d: 0, e: "" })).toEqual({ c: false, d: 0, e: "" });
  });
});

describe("personBody", () => {
  it("makes a person from the form, trimmed, without empty fields, and the kind's rules hold", () => {
    const body = personBody({ name: "  Sam ", pronouns: "", notes: " Likes futomomo ", default_role: "model", is_educator: true,
      aliases: JSON.stringify([{ platform: "fetlife", alias: "sam_ties" }]), about_shared_on: "" }, null, NOW);
    expect(body).toEqual({ name: "Sam", notes: "Likes futomomo", default_role: "bottom", is_educator: true,
      aliases: [{ platform: "fetlife", alias: "sam_ties" }], created_at: NOW, updated_at: NOW });
    expect(recordProblems("person", body)).toEqual([]);
  });

  it("needs a name", () => {
    expect(() => personBody({ name: " " }, null, NOW)).toThrow("Give the person a name.");
  });

  it("keeps who is me, fields the form hasn't, and when it was made and archived; edits can't make someone me", () => {
    const prev = { name: "Me", is_self: true, created_at: NOW, archived_at: null, profile_notes: [{ id: "n1", type: "like", description: "x" }] };
    const edited = personBody({ name: "Jude", is_self: false }, prev, LATER);
    expect(edited).toMatchObject({ name: "Jude", is_self: true, created_at: NOW, updated_at: LATER, profile_notes: prev.profile_notes });
    expect(personBody({ name: "Sam", is_self: true }, { name: "Sam", created_at: NOW }, LATER).is_self).toBeUndefined();
  });

  it("adds one already archived with archive_now, but never me", () => {
    expect(personBody({ name: "Once", archive_now: true }, null, NOW).archived_at).toBe(NOW);
    expect(personBody({ name: "Me", is_self: true, archive_now: true }, null, NOW).archived_at).toBeUndefined();
  });
});

describe("locationBody", () => {
  it("makes a location, with its coordinates as numbers", () => {
    const body = locationBody({ name: "Studio", maps_url: "https://maps.google.com/?q=51.5,-0.12", latitude: "51.5", longitude: "-0.12",
      city: "London", is_default: true }, null, NOW);
    expect(body).toEqual({ name: "Studio", maps_url: "https://maps.google.com/?q=51.5,-0.12", latitude: 51.5, longitude: -0.12,
      city: "London", is_default: true, created_at: NOW, updated_at: NOW });
    expect(recordProblems("location", body)).toEqual([]);
  });

  it("adds a one-off already archived, and not the default", () => {
    expect(locationBody({ name: "Hotel", archive_now: true, is_default: true }, null, NOW)).toMatchObject({ archived_at: NOW, is_default: false });
  });

  it("refuses making an archived one the default", () => {
    expect(() => locationBody({ name: "Old", is_default: true }, { name: "Old", archived_at: NOW }, LATER)).toThrow(ARCHIVED_DEFAULT);
  });

  it("refuses a bad link or coordinate", () => {
    expect(() => locationBody({ name: "X", maps_url: "ftp://x" }, null, NOW)).toThrow(/https/);
    expect(() => locationBody({ name: "X", latitude: "91" }, null, NOW)).toThrow(/-90 to 90/);
  });
});

describe("across records", () => {
  const loc = (/** @type {string} */ id, /** @type {boolean} */ isDefault) => ({ kind: "location", id, body: { name: id, is_default: isDefault } });

  it("one default location: making one the default clears the other", () => {
    const writes = clearOtherDefaults([loc("a", true), loc("b", false), loc("c", false)], "c", NOW);
    expect(writes).toEqual([{ kind: "location", id: "a", from: { name: "a", is_default: true }, body: { name: "a", is_default: false, updated_at: NOW } }]);
    expect(clearOtherDefaults([loc("a", true)], "a", NOW)).toEqual([]);
  });

  it("archiving keeps the first date, takes away a location's default, and refuses me; restoring clears it", () => {
    const first = archived({ kind: "location", id: "a", body: { name: "a", is_default: true } }, NOW);
    expect(first.body).toEqual({ name: "a", is_default: false, archived_at: NOW, updated_at: NOW });
    expect(archived({ kind: "location", id: "a", body: first.body }, LATER).body.archived_at).toBe(NOW);
    expect(() => archived({ kind: "person", id: "me", body: { name: "Me", is_self: true } }, NOW)).toThrow(SELF_KEPT);
    expect(restored({ kind: "location", id: "a", body: first.body }, LATER).body).toEqual({ name: "a", is_default: false, updated_at: LATER });
  });

  it("a deleted person stays on ties and workshops as no one; me can't be deleted", () => {
    const items = [
      { kind: "tie", id: "t1", body: { participants: [{ person_id: "sam", role: "bottom" }, { person_id: "me", role: "top" }] } },
      { kind: "tie", id: "t2", body: { participants: [{ person_id: "alex", role: "bottom" }] } },
      { kind: "workshop", id: "w1", body: { people: [{ person_id: "sam", kind: "educator" }] } },
    ];
    const writes = personDeleted({ kind: "person", id: "sam", body: { name: "Sam" } }, items, NOW);
    expect(writes.map((w) => [w.id, w.body.participants ?? w.body.people])).toEqual([
      ["t1", [{ person_id: null, role: "bottom" }, { person_id: "me", role: "top" }]],
      ["w1", [{ person_id: null, kind: "educator" }]],
    ]);
    expect(() => personDeleted({ kind: "person", id: "me", body: { name: "Me", is_self: true } }, items, NOW)).toThrow(SELF_KEPT);
  });

  it("a deleted location shows on its ties and workshops as deleted", () => {
    const items = [
      { kind: "tie", id: "t1", body: { tie_date: "2026-11-14", tie_type: "floor", location_id: "studio" } },
      { kind: "workshop", id: "w1", body: { title: "W", start_date: "2026-11-14", location_id: "studio" } },
      { kind: "tie", id: "t2", body: { location_id: "home" } },
    ];
    const writes = locationDeleted({ kind: "location", id: "studio", body: { name: "Studio" } }, items, NOW);
    expect(writes.map((w) => [w.id, w.body.location_id, w.body.location_deleted])).toEqual([["t1", undefined, true], ["w1", undefined, true]]);
    expect(writes.every((w) => recordProblems(/** @type {any} */ (w.kind), w.body).length === 0)).toBe(true);
  });
});
