import { describe, it, expect } from "vitest";
import { convertJournal, withoutUnreadableMarks } from "../../public/js/journal-fields.js";
import { duplicatePositions } from "../../public/js/import-dedupe.js";

// Marks each record with its kind, to see each went through as the right one.
/** @type {import("../../public/js/journal-fields.js").Convert} */
const mark = async (kind, records) => records.map((r) => ({ ...r, kind }));

describe("convertJournal", () => {
  it("converts every kind, children included, keeping them in place", async () => {
    const doc = {
      format: "rope-journal-export",
      people: [{ id: "p1", profile_notes: [{ description: "a" }, { description: "b" }] }, { id: "p2" }, { id: "p3", profile_notes: [{ description: "c" }] }],
      locations: [{ id: "l1" }], plans: [{ id: "x" }], tags: ["floor"],
      ties: [{ id: "t1", participants: [{ person_id: "p1" }] }, { id: "t2", participants: [] }],
    };
    const out = await convertJournal(doc, mark);
    expect(out.format).toBe("rope-journal-export");
    expect(out.tags).toEqual(["floor"]);
    expect(out.people.map((p) => [p.kind, (p.profile_notes ?? []).map((/** @type {any} */ n) => `${n.kind}:${n.description}`)])).toEqual([
      ["person", ["profileNote:a", "profileNote:b"]], ["person", []], ["person", ["profileNote:c"]],
    ]);
    expect(out.locations[0].kind).toBe("location");
    expect(out.plans[0].kind).toBe("plan");
    expect(out.ties.map((t) => [t.kind, t.participants.map((/** @type {any} */ p) => p.kind)])).toEqual([["tie", ["participant"]], ["tie", []]]);
  });

  it("asks for each kind once, not once per record", async () => {
    const calls = [];
    await convertJournal({ ties: [{ participants: [{}, {}] }, { participants: [{}] }] }, async (kind, records) => {
      calls.push([kind, records.length]);
      return records;
    });
    expect(calls).toEqual([["person", 0], ["profileNote", 0], ["tie", 2], ["participant", 3], ["location", 0], ["plan", 0]]);
  });
});

describe("withoutUnreadableMarks", () => {
  it("takes the marks off and counts the fields", () => {
    const { doc, unreadable } = withoutUnreadableMarks({
      people: [{ id: "p", notes: null, unreadable: ["notes"], profile_notes: [{ description: null, unreadable: ["description"] }] }],
      plans: [{ id: "x", description: null, notes: null, unreadable: ["description", "notes"] }],
      ties: [{ id: "t", notes: "ok", participants: [] }],
    });
    expect(unreadable).toBe(4);
    expect(JSON.stringify(doc)).not.toContain("unreadable");
    expect(doc.ties[0].notes).toBe("ok");
  });
});

describe("duplicatePositions", () => {
  it("finds the ties whose notes match a candidate's, ignoring spaces round them", () => {
    const fileTies = [{ notes: "Went well " }, { notes: "Different" }, { notes: "" }, { notes: null }];
    const candidates = [
      { i: 0, notes: "Went well" }, { i: 1, notes: "Went well" }, { i: 2, notes: null }, { i: 3, notes: "Something" }, { i: 3, notes: null },
    ];
    expect(duplicatePositions(fileTies, candidates)).toEqual([0, 2, 3]);
  });

  it("finds none without candidates", () => {
    expect(duplicatePositions([{ notes: "x" }], [])).toEqual([]);
  });
});
