// The Analytics map's sums: where a place goes on the map (Mercator, like
// most web maps), the view to start at, zooming and panning, and grouping
// pins that would overlap. Pure, so it's easy to test; world-map.js draws.
//
// Positions are in "world units": the whole world is WORLD wide (and, up to
// 85° north and south, as tall). The country outlines (world-shapes.js,
// made by scripts/world-map.mjs) use the same units, so a view is just the
// part of the world shown, as an SVG viewBox.

/**
 * @typedef {import("./stats.js").StatsTie} StatsTie
 * @typedef {{ x: number, y: number, w: number, h: number }} View
 * @typedef {{ key: string, label: string, x: number, y: number, tieIds: string[] }} Place
 * @typedef {{ key: string, label: string, x: number, y: number, places: Place[], tieIds: string[] }} Pin
 */

export const WORLD = 10000;
/** The map's width over its height (app.css draws it at the same). */
export const ASPECT = 3 / 2;
/** Mercator stretches without end towards the poles; web maps stop here. */
const MAX_LAT = 85;
/** Zoomed in as far as this (about 8 km across); further shows nothing new. */
export const MIN_WIDTH = 2;
/** Fitting the pins zooms in no further than this (about 160 km across). */
const MIN_FIT_WIDTH = 40;
/** Each + or − zooms by this much. */
export const ZOOM_STEP = 2;

/**
 * Where a latitude and longitude go on the map.
 * @param {number} lat
 * @param {number} lng
 * @returns {{ x: number, y: number }}
 */
export function project(lat, lng) {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * WORLD,
    y: ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * WORLD,
  };
}

/**
 * The whole world, as far out as the map goes: about 84° north to 58°
 * south (all of the land but Antarctica), at ASPECT.
 * @type {View}
 */
export const WORLD_VIEW = (() => {
  const top = project(84, 0).y;
  const h = WORLD / ASPECT;
  const bottom = project(-58, 0).y;
  return { x: 0, y: (top + bottom) / 2 - h / 2, w: WORLD, h };
})();

/**
 * Keeps a view between the zoom limits, at the map's shape, and over the
 * world.
 * @param {View} view
 * @returns {View}
 */
export function clampView(view) {
  const w = Math.max(MIN_WIDTH, Math.min(WORLD_VIEW.w, view.w));
  const h = w / ASPECT;
  // A view at the limits keeps the middle it asked for.
  const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
  const between = (/** @type {number} */ n, /** @type {number} */ lo, /** @type {number} */ hi) => Math.max(lo, Math.min(hi, n));
  return {
    x: between(cx - w / 2, WORLD_VIEW.x, WORLD_VIEW.x + WORLD_VIEW.w - w),
    y: between(cy - h / 2, WORLD_VIEW.y, WORLD_VIEW.y + WORLD_VIEW.h - h),
    w, h,
  };
}

/**
 * The view that shows every place, with room around them (more above, for
 * the pins standing up from their spot), or the whole world without any.
 * @param {{ x: number, y: number }[]} places
 * @returns {View}
 */
export function fitView(places) {
  if (!places.length) return WORLD_VIEW;
  const xs = places.map((p) => p.x), ys = places.map((p) => p.y);
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const spanW = right - left, spanH = bottom - top;
  let w = Math.max(spanW * 1.3, (spanH * 1.45) * ASPECT, MIN_FIT_WIDTH);
  w = Math.min(w, WORLD_VIEW.w);
  const h = w / ASPECT;
  // The places' middle, a little below the view's, leaving room for pins.
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2 - h * 0.05;
  return clampView({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/**
 * Zooms in (factor over 1) or out (under 1), keeping the middle.
 * @param {View} view
 * @param {number} factor
 */
export function zoomView(view, factor) {
  const w = view.w / factor, h = view.h / factor;
  return clampView({ x: view.x + (view.w - w) / 2, y: view.y + (view.h - h) / 2, w, h });
}

/**
 * Moves the view by dx, dy world units, stopping at the world's edges.
 * @param {View} view
 * @param {number} dx
 * @param {number} dy
 */
export function panView(view, dx, dy) {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy });
}

/** @param {View} view */
export const canZoomIn = (view) => view.w > MIN_WIDTH * 1.001;
/** @param {View} view */
export const canZoomOut = (view) => view.w < WORLD_VIEW.w * 0.999;

/**
 * The ties' locations that have coordinates, each with its ties, busiest
 * first. `shown` counts the ties on the map, `total` all of them: ties
 * without a location, at one without coordinates, or whose location was
 * deleted aren't on it.
 * @param {StatsTie[]} ties
 * @returns {{ places: Place[], shown: number, total: number }}
 */
export function mapPlaces(ties) {
  /** @type {Map<string, Place>} */
  const byId = new Map();
  let shown = 0;
  for (const tie of ties) {
    const { location_id: id, latitude: lat, longitude: lng } = tie;
    if (!id || typeof lat !== "number" || typeof lng !== "number") continue;
    shown++;
    let place = byId.get(id);
    if (!place) {
      place = { key: id, label: tie.location_name || "(no name)", ...project(lat, lng), tieIds: [] };
      byId.set(id, place);
    }
    place.tieIds.push(tie.id);
  }
  const places = [...byId.values()].sort((a, b) => b.tieIds.length - a.tieIds.length || a.label.localeCompare(b.label));
  return { places, shown, total: ties.length };
}

/**
 * Groups places closer than `radius` world units into one pin, so pins
 * don't hide each other; zooming in shrinks the radius in world units, and
 * they come apart. Each group starts at its busiest place and takes in the
 * places near it; the pin stands at their middle, weighted by ties. Pins
 * come out west to east, the order they're tabbed through.
 * @param {Place[]} places busiest first (as mapPlaces gives them)
 * @param {number} radius
 * @returns {Pin[]}
 */
export function groupPlaces(places, radius) {
  /** @type {{ anchor: Place, places: Place[] }[]} */
  const groups = [];
  for (const place of places) {
    const near = groups.find((g) => Math.hypot(g.anchor.x - place.x, g.anchor.y - place.y) < radius);
    if (near) near.places.push(place);
    else groups.push({ anchor: place, places: [place] });
  }
  return groups.map(({ anchor, places: members }) => {
    const tieIds = members.flatMap((p) => p.tieIds);
    const weight = (/** @type {(p: Place) => number} */ of) =>
      members.reduce((sum, p) => sum + of(p) * p.tieIds.length, 0) / tieIds.length;
    return {
      key: members.map((p) => p.key).join(","),
      label: members.length === 1 ? anchor.label : `${members.length} locations`,
      x: weight((p) => p.x), y: weight((p) => p.y),
      places: members, tieIds,
    };
  }).sort((a, b) => a.x - b.x);
}
