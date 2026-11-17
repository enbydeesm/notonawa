// The map of feature areas that picks which checks a change needs
// (scripts/areas.mjs).
import { describe, it, expect } from "vitest";
import { AREAS, SHARED, TESTS, UI_SHARED, IGNORED, UI_CHUNKS, UI_SECONDS, batches, matches, planFor, planForAreas } from "../../scripts/areas.mjs";

// Every file the map has to cover, found by Vite when the test is built.
// Keys only: nothing is loaded.
const glob = (/** @type {Record<string, unknown>} */ found) => Object.keys(found).map((key) => key.replace(/^\//, ""));
const SOURCES = [
  ...glob(import.meta.glob("/src/**/*.js")),
  ...glob(import.meta.glob("/public/js/**/*.js")),
  ...glob(import.meta.glob("/scripts/*.mjs")),
  ...glob(import.meta.glob("/migrations/*.sql")),
];
const CHUNK_FILES = glob(import.meta.glob("/scripts/ui/chunks/*.mjs"));

describe("the area map", () => {
  it("found the files to check", () => {
    expect(SOURCES).toContain("src/index.js");
    expect(SOURCES).toContain("public/js/app.js");
  });

  it("puts every source file and script in an area or the shared list", () => {
    const missing = SOURCES.filter((file) =>
      !matches(file, SHARED) && !matches(file, UI_SHARED) && !matches(file, IGNORED) && !AREAS.some((a) => matches(file, a.files)));
    expect(missing).toEqual([]);
  });

  it("names only chunks that exist", () => {
    expect(AREAS.flatMap((a) => a.ui).filter((name) => !UI_CHUNKS.includes(name))).toEqual([]);
    expect(UI_CHUNKS.map((name) => `scripts/ui/chunks/${name}.mjs`).sort()).toEqual([...CHUNK_FILES].sort());
  });

  it("gives every area a different name", () => {
    expect(new Set(AREAS.map((a) => a.name)).size).toBe(AREAS.length);
  });

  it("names only source files that exist", () => {
    const named = [...SHARED, ...UI_SHARED, ...AREAS.flatMap((a) => a.files)]
      .filter((entry) => /^(src|public\/js)\/.*\.js$|^scripts\/[^/]+\.mjs$/.test(entry));
    expect(named.filter((entry) => !SOURCES.includes(entry))).toEqual([]);
  });
});

describe("matches", () => {
  it("matches a file exactly, or anything under a folder", () => {
    expect(matches("src/ties/db.js", ["src/ties/"])).toBe(true);
    expect(matches("src/ties.js", ["src/ties/"])).toBe(false);
    expect(matches("public/js/tags.js", ["public/js/tags.js"])).toBe(true);
    expect(matches("public/js/tags.js.bak", ["public/js/tags.js"])).toBe(false);
  });
});

describe("planFor", () => {
  it("runs an area's chunks for one of its files", () => {
    const plan = planFor(["public/js/views/people.js"]);
    expect(plan.areas).toEqual(["people"]);
    expect(plan.ui).toEqual(["people", "locations", "ties", "search", "shares"]);
    expect(plan.generated).toEqual([]);
  });

  it("joins the areas of a file in more than one", () => {
    const plan = planFor(["src/ties/search.js"]);
    expect(plan.areas).toEqual(["search", "ties"]);
    expect(plan.ui).toEqual(["plans", "ties", "search", "notes", "deleting", "insights", "education"]);
  });

  it("keeps the walkthrough's order", () => {
    expect(planFor(["src/stats/db.js", "public/js/views/signin.js"]).ui).toEqual(["basics", "lock", "account", "insights", "link"]);
  });

  it("runs everything for a shared file, naming it", () => {
    const plan = planFor(["public/js/api.js", "src/tags/db.js"]);
    expect(plan.ui).toEqual(UI_CHUNKS);
    expect(plan.everything).toEqual(["public/js/api.js"]);
    expect(plan.generated).toEqual(["privacy", "releases", "vendor"]);
  });

  it("runs everything for a file in no area, and says which", () => {
    const plan = planFor(["src/brand-new.js"]);
    expect([plan.ui.length, plan.unmapped]).toEqual([UI_CHUNKS.length, ["src/brand-new.js"]]);
  });

  it("runs no chunk for a test or test helper, new ones too (every test always runs)", () => {
    expect(TESTS).toEqual(["test/"]);
    for (const file of ["test/unit/brand-new.test.js", "test/api/ties.test.js", "test/helpers.js"]) {
      expect(planFor([file])).toEqual({ areas: [], ui: [], generated: [], unmapped: [], everything: [] });
    }
  });

  it("runs every chunk for the walkthrough's machinery", () => {
    expect(planFor(["scripts/ui/harness.mjs"])).toMatchObject({ ui: UI_CHUNKS, everything: [] });
  });

  it("runs one chunk when only it changed", () => {
    expect(planFor(["scripts/ui/chunks/photos.mjs"])).toMatchObject({ areas: [], ui: ["photos"] });
  });

  it("runs a generated file's check when its source changes", () => {
    expect(planFor(["PRIVACY.md"]).generated).toEqual(["privacy"]);
    expect(planFor(["RELEASES.md"]).generated).toEqual(["releases"]);
  });

  it("runs nothing for notes and docs", () => {
    expect(planFor(["roadmap.md", "considerations.md", "public/img/logo.png"]))
      .toEqual({ areas: [], ui: [], generated: [], unmapped: [], everything: [] });
  });
});

describe("planForAreas", () => {
  it("runs the named areas' checks", () => {
    const plan = planForAreas(["plans", "tour", "releases"]);
    expect(plan.areas).toEqual(["plans", "releases", "tour"]);
    expect(plan.ui).toEqual(["basics", "settings", "plans"]);
    expect(plan.generated).toEqual(["releases"]);
  });

  it("refuses a name that isn't an area", () => {
    expect(() => planForAreas(["peple"])).toThrow('No area called "peple".');
  });
});

describe("batches", () => {
  it("gives every chunk a time", () => {
    expect(Object.keys(UI_SECONDS).sort()).toEqual([...UI_CHUNKS].sort());
  });

  it("shares chunks out so the runs take about as long, each in the walkthrough's order", () => {
    const seconds = { a: 60, b: 30, c: 30, d: 20, e: 20, f: 20 };
    expect(batches(["a", "b", "c", "d", "e", "f"], 3, seconds)).toEqual([["a"], ["b", "d", "f"], ["c", "e"]]);
  });

  it("uses every chunk once, and no more runs than chunks", () => {
    const runs = batches(UI_CHUNKS, 3);
    expect(runs.flat().sort()).toEqual([...UI_CHUNKS].sort());
    expect(runs).toHaveLength(3);
    const totals = runs.map((r) => r.reduce((sum, name) => sum + UI_SECONDS[name], 0));
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThan(UI_SECONDS.account);
    expect(batches(["people", "plans"], 3)).toEqual([["plans"], ["people"]]);
  });

  it("runs everything in one for one job (or a nonsense number)", () => {
    expect(batches(["people", "plans"], 1)).toEqual([["people", "plans"]]);
    expect(batches(["people", "plans"], 0)).toEqual([["people", "plans"]]);
    expect(batches(["people"], Number.NaN)).toEqual([["people"]]);
  });

  it("counts an unlisted chunk as 30 seconds", () => {
    expect(batches(["new", "people", "locations"], 2)).toEqual([["new"], ["people", "locations"]]);
  });
});
