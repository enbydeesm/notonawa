import { describe, it, expect } from "vitest";
import {
  WORLD, ASPECT, WORLD_VIEW, MIN_WIDTH, project, clampView, fitView, zoomView, panView, canZoomIn, canZoomOut,
  mapPlaces, groupPlaces,
} from "../../public/js/map-geo.js";
import { ringPath, countriesPath, shapesFile } from "../../scripts/world-map-lib.mjs";
import { COUNTRIES } from "../../public/js/world-shapes.js";

/** @typedef {import("../../public/js/stats.js").StatsTie} StatsTie */

/**
 * @param {string} id
 * @param {Partial<StatsTie>} fields
 * @returns {StatsTie}
 */
function tie(id, fields = {}) {
  return {
    id, tie_date: "2026-01-01", tie_type: "floor", duration_minutes: null, success_rating: null,
    location_id: null, location_deleted: 0, location_name: null, latitude: null, longitude: null,
    participants: [], ...fields,
  };
}

/** @param {number} x @param {number} y @param {string} key @param {number} [ties] */
const place = (x, y, key, ties = 1) => ({ key, label: key, x, y, tieIds: Array.from({ length: ties }, (_, i) => `${key}${i}`) });

describe("the map's projection", () => {
  it("puts 0, 0 in the middle, and the date line at the edges", () => {
    expect(project(0, 0)).toEqual({ x: WORLD / 2, y: WORLD / 2 });
    expect(project(0, -180).x).toBe(0);
    expect(project(0, 180).x).toBe(WORLD);
  });

  it("puts the north at the top and stops at 85°", () => {
    expect(project(51.5, 0).y).toBeLessThan(project(-33.9, 0).y);
    expect(project(90, 0).y).toBeCloseTo(project(85, 0).y);
    expect(project(85, 0).y).toBeGreaterThan(-1);
  });

  it("shows the whole world (but Antarctica) at the map's shape", () => {
    expect(WORLD_VIEW.w).toBe(WORLD);
    expect(WORLD_VIEW.w / WORLD_VIEW.h).toBeCloseTo(ASPECT);
    expect(WORLD_VIEW.y).toBeLessThan(project(83.5, 0).y);
    expect(WORLD_VIEW.y + WORLD_VIEW.h).toBeGreaterThan(project(-57.5, 0).y);
  });
});

describe("the map's view", () => {
  it("shows the whole world with no places", () => {
    expect(fitView([])).toEqual(WORLD_VIEW);
  });

  it("fits every place, with room around them", () => {
    const places = [place(2000, 3000, "a"), place(2600, 3300, "b"), place(2300, 3500, "c")];
    const view = fitView(places);
    for (const p of places) {
      expect(p.x).toBeGreaterThan(view.x);
      expect(p.x).toBeLessThan(view.x + view.w);
      // Room above for the pins standing up from their spot.
      expect(p.y).toBeGreaterThan(view.y + view.h * 0.1);
      expect(p.y).toBeLessThan(view.y + view.h);
    }
    expect(view.w / view.h).toBeCloseTo(ASPECT);
    expect(view.w).toBeLessThan(1200);
  });

  it("zooms in on one place only so far", () => {
    const view = fitView([place(5000, 3000, "a")]);
    expect(view.w).toBe(40);
    expect(view.x + view.w / 2).toBeCloseTo(5000);
  });

  it("stays over the world when the places are at its edge", () => {
    const view = fitView([place(1, 3000, "a"), place(9999, 3000, "b")]);
    expect(view).toEqual(clampView(view));
    expect(view.x).toBeGreaterThanOrEqual(0);
    expect(view.x + view.w).toBeLessThanOrEqual(WORLD);
  });

  it("zooms by the factor, keeping the middle, between the limits", () => {
    const view = clampView({ x: 4000, y: 3000, w: 800, h: 800 / ASPECT });
    const closer = zoomView(view, 2);
    expect(closer.w).toBe(400);
    expect(closer.x + closer.w / 2).toBeCloseTo(4400);
    expect(closer.y + closer.h / 2).toBeCloseTo(view.y + view.h / 2);
    expect(zoomView(view, 1000).w).toBe(MIN_WIDTH);
    expect(zoomView(view, 1 / 1000)).toEqual(WORLD_VIEW);
    expect(canZoomIn(zoomView(view, 1000))).toBe(false);
    expect(canZoomOut(WORLD_VIEW)).toBe(false);
    expect([canZoomIn(view), canZoomOut(view)]).toEqual([true, true]);
  });

  it("pans, stopping at the world's edges", () => {
    const view = clampView({ x: 4000, y: 3000, w: 800, h: 800 / ASPECT });
    expect(panView(view, 100, -50)).toMatchObject({ x: 4100, y: 2950, w: 800 });
    expect(panView(view, -99999, 0).x).toBe(0);
    expect(panView(view, 99999, 0).x).toBe(WORLD - 800);
    expect(panView(view, 0, 99999).y + view.h).toBeCloseTo(WORLD_VIEW.y + WORLD_VIEW.h);
  });
});

describe("the map's places", () => {
  it("keeps the ties at a location with coordinates, a place for each location, busiest first", () => {
    const studio = { location_id: "s", location_name: "Studio", latitude: 51.5, longitude: -0.12 };
    const ties = [
      tie("1", studio),
      tie("2", { location_id: "h", location_name: "Hotel", latitude: -33.9, longitude: 151.2 }),
      tie("3", studio),
      tie("4", { location_id: "n", location_name: "No coordinates" }),
      tie("5"),
      // A location that was deleted.
      tie("6", { location_deleted: 1 }),
    ];
    const { places, shown, total } = mapPlaces(ties);
    expect([shown, total]).toEqual([3, 6]);
    expect(places.map((p) => [p.key, p.label, p.tieIds])).toEqual([["s", "Studio", ["1", "3"]], ["h", "Hotel", ["2"]]]);
    expect(places[0]).toMatchObject(project(51.5, -0.12));
  });

  it("keeps coordinates of 0", () => {
    expect(mapPlaces([tie("1", { location_id: "z", location_name: "Null Island", latitude: 0, longitude: 0 })]).shown).toBe(1);
  });
});

describe("grouping pins", () => {
  const places = [place(100, 100, "big", 3), place(110, 100, "near"), place(500, 100, "far", 2)];

  it("groups places closer than the radius around the busiest, west to east", () => {
    const pins = groupPlaces(places, 30);
    expect(pins.map((p) => [p.label, p.places.length, p.tieIds.length])).toEqual([["2 locations", 2, 4], ["far", 1, 2]]);
    // At the middle, weighted by ties.
    expect(pins[0].x).toBeCloseTo(102.5);
    expect(pins[0].key).toBe("big,near");
  });

  it("comes apart when zoomed in (a smaller radius)", () => {
    expect(groupPlaces(places, 5).map((p) => p.label)).toEqual(["big", "near", "far"]);
  });

  it("groups everything when zoomed far out", () => {
    const [pin] = groupPlaces(places, 10000);
    expect(pin.tieIds.length).toBe(6);
  });
});

describe("the country outlines", () => {
  it("writes a ring as whole-unit steps, dropping repeated points", () => {
    // A small square around 0, 0: the same corner twice, and closed.
    const d = ringPath([[0, 0], [1, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
    const x1 = Math.round(project(0, 1).x) - WORLD / 2;
    const y1 = Math.round(project(1, 0).y) - WORLD / 2;
    expect(d).toBe(`M5000 5000l${x1} 0 0${y1}-${x1} 0z`);
  });

  it("drops a ring that rounds to less than a triangle", () => {
    expect(ringPath([[0, 0], [0.001, 0], [0, 0.001], [0, 0]])).toBe("");
  });

  it("joins every country but Antarctica", () => {
    const square = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
    const path = countriesPath({
      features: [
        { properties: { ADMIN: "A" }, geometry: { type: "Polygon", coordinates: /** @type {any} */ (square) } },
        { properties: { ADMIN: "B" }, geometry: { type: "MultiPolygon", coordinates: /** @type {any} */ ([square, square]) } },
        { properties: { ADMIN: "Antarctica" }, geometry: { type: "Polygon", coordinates: /** @type {any} */ (square) } },
      ],
    });
    expect(path.match(/M/g)?.length).toBe(3);
    expect(shapesFile(path)).toContain(`export const COUNTRIES = ${JSON.stringify(path)};`);
  });

  it("are built: one path, inside the world", () => {
    expect(COUNTRIES).toMatch(/^M\d+ \d+l[-\d ]+z(M\d+ \d+l[-\d ]+z)+$/);
    expect(COUNTRIES.match(/M/g)?.length).toBeGreaterThan(200);
  });
});
