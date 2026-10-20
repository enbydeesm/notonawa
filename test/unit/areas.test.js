// The map of feature areas that picks which checks a change needs
// (scripts/areas.mjs).
import { describe, it, expect } from "vitest";
import { AREAS, SHARED, TEST_SHARED, UI_SHARED, IGNORED, UI_CHUNKS, matches, planFor, planForAreas } from "../../scripts/areas.mjs";

// Every file the map has to cover, found by Vite when the test is built
// (the tests run in the Workers runtime, which can't list folders). Keys
// only: nothing is loaded.
const glob = (/** @type {Record<string, unknown>} */ found) => Object.keys(found).map((key) => key.replace(/^\//, ""));
const SOURCES = [
  ...glob(import.meta.glob("/src/**/*.js")),
  ...glob(import.meta.glob("/public/js/**/*.js")),
  ...glob(import.meta.glob("/scripts/*.mjs")),
  ...glob(import.meta.glob("/migrations/*.sql")),
];
// Vite leaves out the file doing the globbing: this one.
const TESTS = [...glob(import.meta.glob("/test/**/*.test.js")), "test/unit/areas.test.js"];
const CHUNK_FILES = glob(import.meta.glob("/scripts/ui/chunks/*.mjs"));

const allTestFiles = AREAS.flatMap((a) => a.tests);

describe("the area map", () => {
  it("found the files to check", () => {
    expect(SOURCES).toContain("src/index.js");
    expect(SOURCES).toContain("public/js/app.js");
    expect(TESTS).toContain("test/api/ties.test.js");
  });

  it("puts every source file and script in an area or the shared list", () => {
    const missing = SOURCES.filter((file) =>
      !matches(file, SHARED) && !matches(file, UI_SHARED) && !matches(file, IGNORED) && !AREAS.some((a) => matches(file, a.files)));
    expect(missing).toEqual([]);
  });

  it("puts every test file in an area", () => {
    expect(TESTS.filter((file) => !allTestFiles.includes(file))).toEqual([]);
  });

  it("names only test files and chunks that exist", () => {
    expect(allTestFiles.filter((file) => !TESTS.includes(file))).toEqual([]);
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

  it("names only test helpers that exist", () => {
    const helpers = glob(import.meta.glob("/test/*.{js,ts}"));
    expect(TEST_SHARED.filter((entry) => !helpers.includes(entry))).toEqual([]);
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
  it("runs an area's tests and chunks for one of its files", () => {
    const plan = planFor(["public/js/views/people.js"]);
    expect(plan.areas).toEqual(["people"]);
    expect(plan.tests).toEqual(["test/api/resources.test.js", "test/unit/aliases.test.js", "test/unit/list-order.test.js"]);
    expect(plan.ui).toEqual(["people", "locations", "ties", "search"]);
    expect(plan.generated).toEqual([]);
  });

  it("joins the areas of a file in more than one", () => {
    const plan = planFor(["src/ties/search.js"]);
    expect(plan.areas).toEqual(["search", "ties"]);
    expect(plan.tests).toContain("test/api/ties.test.js");
    expect(plan.tests).toContain("test/api/ties-search.test.js");
  });

  it("keeps the walkthrough's order", () => {
    expect(planFor(["src/stats/db.js", "public/js/views/signin.js"]).ui).toEqual(["basics", "lock", "account", "insights"]);
  });

  it("runs everything for a shared file, naming it", () => {
    const plan = planFor(["public/js/api.js", "src/tags/db.js"]);
    expect(plan.tests).toBe("all");
    expect(plan.ui).toEqual(UI_CHUNKS);
    expect(plan.everything).toEqual(["public/js/api.js"]);
    expect(plan.generated).toEqual(["privacy", "releases", "welcome"]);
  });

  it("runs everything for a file in no area, and says which", () => {
    const plan = planFor(["src/brand-new.js"]);
    expect([plan.tests, plan.ui.length, plan.unmapped]).toEqual(["all", UI_CHUNKS.length, ["src/brand-new.js"]]);
  });

  it("runs a changed test itself, even one in no area yet", () => {
    expect(planFor(["test/unit/brand-new.test.js"])).toMatchObject({ tests: ["test/unit/brand-new.test.js"], ui: [], unmapped: [] });
    expect(planFor(["test/unit/router.test.js"])).toMatchObject({ areas: ["core"], tests: expect.arrayContaining(["test/unit/router.test.js"]), ui: [] });
  });

  it("runs every test for a test helper, and every chunk for the walkthrough's machinery", () => {
    expect(planFor(["test/helpers.js"])).toMatchObject({ tests: "all", ui: [] });
    expect(planFor(["scripts/ui/harness.mjs"])).toMatchObject({ tests: [], ui: UI_CHUNKS });
  });

  it("runs one chunk when only it changed", () => {
    expect(planFor(["scripts/ui/chunks/photos.mjs"])).toMatchObject({ tests: [], ui: ["photos"] });
  });

  it("runs a generated file's check when its source changes", () => {
    expect(planFor(["PRIVACY.md"]).generated).toEqual(["privacy"]);
    expect(planFor(["RELEASES.md"]).generated).toEqual(["releases"]);
    expect(planFor(["WELCOME.md"]).generated).toEqual(["welcome"]);
  });

  it("runs nothing for notes and docs", () => {
    expect(planFor(["roadmap.md", "considerations.md", "public/img/logo.png"]))
      .toEqual({ areas: [], tests: [], ui: [], generated: [], unmapped: [], everything: [] });
  });
});

describe("planForAreas", () => {
  it("runs the named areas' checks", () => {
    const plan = planForAreas(["plans", "welcome"]);
    expect(plan.areas).toEqual(["plans", "welcome"]);
    expect(plan.tests).toEqual(["test/api/resources.test.js", "test/unit/plans-view.test.js", "test/unit/welcome-lib.test.js"]);
    expect(plan.ui).toEqual(["basics", "plans"]);
    expect(plan.generated).toEqual(["welcome"]);
  });

  it("refuses a name that isn't an area", () => {
    expect(() => planForAreas(["peple"])).toThrow('No area called "peple".');
  });
});
