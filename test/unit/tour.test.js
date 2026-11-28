import { describe, it, expect } from "vitest";
import { STOPS, FINISH, stepAt, COFFEE_URL, CONTACT_EMAIL } from "../../public/js/tour-steps.js";
import { ringFor, sideFor, pointerX, pointerPoints, RING_GAP, POINTER_INSET } from "../../public/js/tour-layout.js";
import NAV from "../../public/js/nav.js?raw";

// The nav's tabs, read from nav.js's PAGES (nav.js needs a page to load).
const TAB_HREFS = [...NAV.slice(NAV.indexOf("export const PAGES"), NAV.indexOf("]);", NAV.indexOf("export const PAGES")))
  .matchAll(/\["(\/[a-z]*)", "/g)].map((m) => m[1]);

describe("the tour's stops", () => {
  it("goes through the tabs in the nav's order, then the poser, the menu and Account Recovery", () => {
    expect(STOPS.map((s) => s.title)).toEqual([
      "Ties", "Plans", "Education", "People", "Locations", "Calendar", "Analytics",
      "Model Poser", "Menu", "Account Recovery",
    ]);
    expect(TAB_HREFS).toHaveLength(7);
    expect(STOPS.slice(0, 7).map((s) => s.target)).toEqual(TAB_HREFS.map((href) => `nav a[href="${href}"]`));
    expect(STOPS.slice(7).map((s) => s.target)).toEqual(["#nav-poser", "nav .nav-menu", null]);
  });

  it("points only at things nav.js draws", () => {
    expect(NAV).toContain('id: "nav-poser"');
    expect(NAV).toContain('className: "nav-icon nav-menu"');
  });

  it("has words for every stop, Account Recovery's warning in italics", () => {
    for (const stop of STOPS) expect(stop.body.flat().length).toBeGreaterThan(0);
    const recovery = STOPS[STOPS.length - 1].body;
    expect(recovery).toHaveLength(2);
    // The warning starts a line of its own, so it isn't split.
    expect(recovery[0]).toEqual(["Because everything is encrypted,", { br: true }, { em: "we cannot restore your data if you lose it" }, "."]);
  });

  it("breaks Locations' line before its aside, rather than wrapping it", () => {
    const [locations] = STOPS.find((s) => s.title === "Locations")?.body ?? [];
    expect(locations.at(-2)).toEqual({ br: true });
    expect(locations.at(-1)).toBe("(if that's your kink).");
  });

  it("numbers the stops from 1, after the welcome, with the wrap-up after the last", () => {
    expect(FINISH).toBe(11);
    expect(stepAt(0)).toEqual({ kind: "welcome", step: 0 });
    expect(stepAt(1)).toMatchObject({ kind: "stop", step: 1, count: "1 of 10", last: false, stop: { title: "Ties" } });
    expect(stepAt(9)).toMatchObject({ count: "9 of 10", last: false, stop: { title: "Menu" } });
    expect(stepAt(10)).toMatchObject({ count: "10 of 10", last: true, stop: { title: "Account Recovery" } });
    expect(stepAt(11)).toEqual({ kind: "finish", step: 11 });
  });

  it("keeps a step out of range to the ends", () => {
    expect(stepAt(-3).kind).toBe("welcome");
    expect(stepAt(Number.NaN).kind).toBe("welcome");
    expect(stepAt(40)).toEqual({ kind: "finish", step: 11 });
    expect(stepAt(2.7)).toMatchObject({ step: 2 });
  });

  it("links to our email and the coffee page", () => {
    expect(CONTACT_EMAIL).toBe("contact@notonawa.app");
    expect(COFFEE_URL).toBe("https://buymeacoffee.com/mx_piggie");
  });
});

describe("the tour's ring and pointer", () => {
  const view = { width: 390, height: 844 };

  it("rings a target a few pixels out", () => {
    expect(ringFor({ left: 16, top: 12, width: 30, height: 34 }, view)).toEqual(
      { left: 16 - RING_GAP, top: 12 - RING_GAP, width: 30 + 2 * RING_GAP, height: 34 + 2 * RING_GAP });
  });

  it("keeps the ring on screen", () => {
    expect(ringFor({ left: 2, top: 1, width: 30, height: 34 }, view)).toEqual({ left: 0, top: 0, width: 37, height: 40 });
    expect(ringFor({ left: 360, top: 12, width: 32, height: 32 }, view)).toEqual({ left: 355, top: 7, width: 35, height: 42 });
  });

  it("has no ring for nothing, or something that takes no room or is off screen", () => {
    expect(ringFor(null, view)).toBeNull();
    expect(ringFor({ left: 10, top: 10, width: 0, height: 0 }, view)).toBeNull();
    expect(ringFor({ left: 500, top: 10, width: 30, height: 30 }, view)).toBeNull();
  });

  it("lines the card up with the nav's edge nearer the icon", () => {
    expect(sideFor({ left: 330, top: 7, width: 40, height: 44 }, 1280)).toBe("start");
    expect(sideFor({ left: 900, top: 7, width: 42, height: 42 }, 1280)).toBe("end");
    expect(sideFor({ left: 150, top: 7, width: 40, height: 44 }, 390)).toBe("start");
    expect(sideFor({ left: 200, top: 7, width: 40, height: 44 }, 390)).toBe("end");
  });

  it("puts the pointer under the ring's middle, kept clear of the card's corners", () => {
    const card = { left: 16, width: 358 };
    expect(pointerX({ left: 150, top: 7, width: 40, height: 44 }, card)).toBe(170);
    expect(pointerX({ left: 11, top: 7, width: 40, height: 44 }, card)).toBe(16 + POINTER_INSET);
    expect(pointerX({ left: 350, top: 7, width: 40, height: 44 }, card)).toBe(16 + 358 - POINTER_INSET);
    expect(pointerX({ left: 0, top: 0, width: 10, height: 10 }, { left: 100, width: 20 })).toBe(110);
  });

  it("draws the pointer from just inside the card's top edge up to a tip", () => {
    expect(pointerPoints(100, 66)).toEqual({ fill: "91,67 100,57 109,67", edge: "91,66 100,57 109,66" });
    expect(pointerPoints(100.04, 66.25, 8).fill).toBe("92,67.3 100,58.3 108,67.3");
  });
});
