import { describe, it, expect } from "vitest";
import { matchRoute, inAppTarget, ROUTES, NOT_FOUND } from "../../public/js/router.js";

describe("matchRoute", () => {
  it("finds every view by its path, with or without a trailing slash", () => {
    for (const route of ROUTES) expect(matchRoute(/** @type {string} */ (route.path))).toBe(route);
    expect(matchRoute("/plans/").view).toBe("plans");
    expect(matchRoute("/").view).toBe("ties");
    expect(matchRoute("//").view).toBe("ties");
  });

  it("gives 'not found' for anything else, including pages that aren't views", () => {
    for (const path of ["/nope", "/plans/extra", "/privacy", "/plans.html", "/import-template.csv", "/api/tags"]) {
      expect(matchRoute(path)).toBe(NOT_FOUND);
    }
  });

  it("hides the nav only on the sign-in view", () => {
    expect(ROUTES.filter((r) => !r.nav).map((r) => r.view)).toEqual(["signin"]);
  });

  it("needs the journal unlocked for every view but sign-in and 'not found'", () => {
    expect(ROUTES.filter((r) => !r.needsKey).map((r) => r.view)).toEqual(["signin"]);
    expect(NOT_FOUND.needsKey).toBe(false);
  });
});

describe("inAppTarget", () => {
  const ORIGIN = "https://rope.example";
  const link = { href: `${ORIGIN}/plans`, target: "", download: false };
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

  it("handles a plain click on a link to a view, keeping its query", () => {
    expect(inAppTarget(link, click, ORIGIN)).toBe("/plans");
    expect(inAppTarget({ ...link, href: `${ORIGIN}/?page=2` }, click, ORIGIN)).toBe("/?page=2");
  });

  it("leaves other sites, other pages and files to the browser", () => {
    for (const href of ["https://maps.example/x", `${ORIGIN}/privacy`, `${ORIGIN}/import-template.csv`, "http://rope.example/plans"]) {
      expect(inAppTarget({ ...link, href }, click, ORIGIN)).toBeNull();
    }
  });

  it("leaves new tabs, downloads and modified or non-left clicks to the browser", () => {
    expect(inAppTarget({ ...link, target: "_blank" }, click, ORIGIN)).toBeNull();
    expect(inAppTarget({ ...link, download: true }, click, ORIGIN)).toBeNull();
    for (const changed of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
      expect(inAppTarget(link, { ...click, ...changed }, ORIGIN)).toBeNull();
    }
    expect(inAppTarget({ ...link, target: "_self" }, click, ORIGIN)).toBe("/plans");
  });
});
