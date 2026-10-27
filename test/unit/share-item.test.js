import { describe, it, expect } from "vitest";
import {
  itemSource, buildItemShare, readItemShare, hasField, shareFiles, visualCounts, mediaSize, FIELDS, LIMITS, SHARE_LEGEND,
} from "../../public/js/share-item.js";

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

describe("photos and videos", () => {
  const F1 = "0b6e1f2c-3d4a-4b5c-8d6e-7f8091a2b3c4";
  const F2 = "1b6e1f2c-3d4a-4b5c-8d6e-7f8091a2b3c4";
  /** @type {import("../../public/js/share-item.js").SharedVisual[]} */
  const MIXED = [
    { kind: "photo", file: F1, mime: "image/jpeg", caption: "Front", mediaId: "m1", bytes: 3 * 1024 * 1024 },
    { kind: "drawing", data: { v: 1, strokes: [] }, caption: null },
    { kind: "video", file: F2, mime: "video/mp4", caption: null, mediaId: "m2", bytes: 1024 * 1024 },
  ];
  const source = () => itemSource("plan", { id: "p", title: "TK" }, { ...EXTRAS, visuals: MIXED });

  it("are their own tickbox, apart from drawings and poses", () => {
    expect(FIELDS.tie.map((f) => f.key)).toContain("media");
    expect([hasField(source(), "media"), hasField(source(), "visuals")]).toEqual([true, true]);
    const drawingsOnly = itemSource("plan", { id: "p", title: "TK" }, { ...EXTRAS, visuals: [MIXED[1]] });
    expect([hasField(drawingsOnly, "media"), hasField(drawingsOnly, "visuals")]).toEqual([false, true]);
  });

  it("go in the visuals' one order, each group only when ticked, never with their ids or sizes in my journal", () => {
    expect(buildItemShare("plan", source(), ["visuals", "media"]).visuals).toEqual([
      { kind: "photo", file: F1, mime: "image/jpeg", caption: "Front" },
      { kind: "drawing", data: { v: 1, strokes: [] }, caption: null },
      { kind: "video", file: F2, mime: "video/mp4", caption: null },
    ]);
    expect(buildItemShare("plan", source(), ["visuals"]).visuals).toEqual([MIXED[1]]);
    expect((/** @type {any[]} */ (buildItemShare("plan", source(), ["media"]).visuals)).map((v) => v.file)).toEqual([F1, F2]);
    expect(buildItemShare("plan", source(), ["title"]).visuals).toBeUndefined();
  });

  it("are listed to upload: the ones in the snapshot, with which of mine each is", () => {
    const s = source();
    expect(shareFiles(s, buildItemShare("plan", s, ["media"]))).toEqual([
      { file: F1, mediaId: "m1", kind: "photo" }, { file: F2, mediaId: "m2", kind: "video" },
    ]);
    expect(shareFiles(s, buildItemShare("plan", s, ["visuals"]))).toEqual([]);
  });

  it("are counted, and sized, in words", () => {
    expect(visualCounts(MIXED, ["photo", "video", "drawing", "pose"])).toBe("1 photo, 1 video, 1 drawing");
    expect(visualCounts([...MIXED, MIXED[0]], ["photo"])).toBe("2 photos");
    expect(mediaSize(MIXED)).toBe("4.0 MB");
    expect(mediaSize([MIXED[1]])).toBe("");
    expect(mediaSize([{ kind: "photo", file: F1, mime: "image/jpeg", caption: null, bytes: 2000 }])).toBe("under 0.1 MB");
  });

  it("are read strictly: a file id made here, a type they're stored as, each once, up to an item's worth", () => {
    const read = (/** @type {unknown[]} */ visuals) => readItemShare("plan", { v: 1, title: "TK", visuals })?.visuals;
    expect(read([{ kind: "photo", file: F1, mime: "image/webp", caption: " Hi ", mediaId: "x" }]))
      .toEqual([{ kind: "photo", file: F1, mime: "image/webp", caption: "Hi" }]);
    for (const bad of [
      { kind: "photo", file: "../x", mime: "image/jpeg" },
      { kind: "photo", file: F1, mime: "image/png" },
      { kind: "video", file: F1, mime: "image/jpeg" },
      { kind: "photo", file: F1.toUpperCase(), mime: "image/jpeg" },
    ]) expect(read([bad]), JSON.stringify(bad)).toEqual([]);
    expect(read([{ kind: "photo", file: F1, mime: "image/jpeg" }, { kind: "video", file: F1, mime: "video/mp4" }])).toHaveLength(1);
    expect(read([{ kind: "photo", file: F1, mime: "image/jpeg", caption: "x".repeat(201) }])?.[0].caption).toBeNull();
    const id = (/** @type {number} */ i) => `${String(i).padStart(8, "0")}-3d4a-4b5c-8d6e-7f8091a2b3c4`;
    const videos = Array.from({ length: 7 }, (_, i) => ({ kind: "video", file: id(i), mime: "video/mp4" }));
    expect(read(videos)).toHaveLength(5);
    const photos = Array.from({ length: 35 }, (_, i) => ({ kind: "photo", file: id(i), mime: "image/jpeg" }));
    expect(read(photos)).toHaveLength(30);
  });
});
