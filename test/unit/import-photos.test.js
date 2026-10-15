// Photos in an import (public/js/import-photos.js), and which existing tie a
// skipped duplicate matches (import-dedupe.js), where its photos go.
import { describe, it, expect } from "vitest";
import { takePhotos, typeFromName, journalEntry } from "../../public/js/import-photos.js";
import { duplicateMatches, duplicatePositions } from "../../public/js/import-dedupe.js";

describe("takePhotos", () => {
  it("takes the photo lists off ties and plans, in order, so their captions are never sent", () => {
    const doc = {
      people: [], locations: [], tags: [],
      plans: [{ id: "p1", title: "TK", photos: [{ file: "photos/b.webp", caption: "Back", position: 1 }, { file: "photos/a.webp", caption: "", position: 0 }] }, { id: "p2", title: "None", photos: [] }],
      ties: [{ title: "One" }, { title: "Two", photos: [{ file: "photos/c.jpg", caption: "Front", position: 0, kind: "photo" }] }],
    };
    const result = takePhotos(doc);
    expect(JSON.stringify(result.doc)).not.toMatch(/photos|Front|Back/);
    expect(result.doc.ties).toEqual([{ title: "One" }, { title: "Two" }]);
    expect(result.count).toBe(3);
    expect([...result.ties]).toEqual([[1, [{ file: "photos/c.jpg", caption: "Front", position: 0 }]]]);
    expect(result.plans.get("p1")).toEqual([
      { file: "photos/a.webp", caption: null, position: 0 },
      { file: "photos/b.webp", caption: "Back", position: 1 },
    ]);
    expect(result.plans.has("p2")).toBe(false);
  });

  it("leaves out entries without a file (couldn't be decrypted when exported) and videos, for now", () => {
    const result = takePhotos({ plans: [], ties: [{ photos: [{ file: null, caption: "x" }, { file: "v.mp4", kind: "video" }, "junk"] }] });
    expect(result.count).toBe(0);
    expect(result.ties.size).toBe(0);
  });
});

describe("typeFromName and journalEntry", () => {
  it("tell a photo's type by its extension", () => {
    expect(["a.webp", "a.JPG", "a.jpeg", "a.png", "a.gif"].map(typeFromName))
      .toEqual(["image/webp", "image/jpeg", "image/jpeg", "image/png", ""]);
  });
  it("find the journal in the zip", () => {
    expect(journalEntry(["photos/a.webp", "rope-journal.json"])).toBe("rope-journal.json");
    expect(journalEntry(["export/my-journal.json", "photos/a.webp", "__MACOSX/._x"])).toBe("export/my-journal.json");
    expect(journalEntry(["a.json", "b.json"])).toBeNull();
    expect(journalEntry(["photos/a.webp"])).toBeNull();
  });
});

describe("duplicateMatches", () => {
  it("gives each duplicate tie the id of the first of mine with the same notes", () => {
    const file = [{ notes: "a" }, { notes: " b " }, { notes: "c" }];
    const candidates = [
      { i: 0, id: "x", notes: "different" }, { i: 0, id: "y", notes: "a" }, { i: 0, id: "z", notes: "a" },
      { i: 1, id: "w", notes: "b" },
      { i: 2, id: "v", notes: null },
    ];
    expect([...duplicateMatches(file, candidates)]).toEqual([[0, "y"], [1, "w"]]);
    expect(duplicatePositions(file, candidates)).toEqual([0, 1]);
  });
});
