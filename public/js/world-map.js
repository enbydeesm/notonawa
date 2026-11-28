// The Analytics map: country outlines with a pin for each location with
// ties, drawn as SVG on the device. No map tiles or map library: those
// would load from another site and tell it where the ties were (see
// considerations.md, "The Analytics map"). analytics.js loads this module
// only when the Map card is about to scroll into view.
//
// The outlines are drawn in world units (map-geo.js) inside an SVG whose own
// units are the map's pixels, so zooming and panning only change the inner
// viewBox, while the pins, placed in pixels, keep their size. Pins closer
// than PIN_GAP pixels are grouped (groupPlaces), and come apart as you zoom
// in. Tapping a pin lists its ties (onPick).

import { h } from "./dom.js";
import { svg } from "./charts.js";
import { tiesWord } from "./chart-parts.js";
import { COUNTRIES } from "./world-shapes.js";
import { NAV_ART, CARABINER_OUTLINE, CARABINER_GROUP_LINES } from "./nav-art.js";
import {
  ASPECT, WORLD_VIEW, ZOOM_STEP, fitView, zoomView, panView, canZoomIn, canZoomOut, groupPlaces,
} from "./map-geo.js";

/**
 * @typedef {import("./map-geo.js").Place} Place
 * @typedef {import("./map-geo.js").Pin} Pin
 * @typedef {import("./map-geo.js").View} View
 * @typedef {{ key: string, label: string, x: number, y: number, workshopIds: string[] }} WorkshopPlace
 */

/** Pins nearer than this many pixels are grouped. */
const PIN_GAP = 30;
/** A drag shorter than this many pixels is a tap. */
const DRAG_START = 5;

/**
 * A pin is the Locations tab's carabiner (nav-art.js), drawn on its 24 × 24
 * grid and scaled to `height` pixels: yellow inside its own lines, its
 * bottom point on the place. A group's carabiner has no ring: its count is
 * where the ring would be. Hover and focus strokes (app.css) stay their CSS
 * width at any size.
 */
const CARABINER_LINES = /** @type {string} */ (NAV_ART.locations[0].d);
/** The carabiner's bottom point and its ring's centre, on its grid. */
const CARABINER_TIP = { x: 12, y: 22.7 };
const CARABINER_RING = { x: 12, y: 7.3 };
/** The carabiner is 22.15 units tall, top to tip. */
const CARABINER_HEIGHT = 22.15;
const PLACE_PIN = { height: 26 };
const GROUP_PIN = { height: 32 };

/**
 * One pin: a button for keyboards and screen readers too. A group shows
 * how many ties it has.
 * @param {Pin} pin
 * @param {(pin: Pin, keyboard?: boolean) => void} pick
 */
function pinElement(pin, pick) {
  const grouped = pin.places.length > 1;
  const { height } = grouped ? GROUP_PIN : PLACE_PIN;
  const scale = height / CARABINER_HEIGHT;
  const label = `${pin.label}: ${tiesWord(pin.tieIds.length)}`;
  const el = svg("g", { class: grouped ? "map-pin grouped" : "map-pin", tabindex: 0, role: "button", "aria-label": label },
    svg("title", {}, label),
    svg("g", { transform: `scale(${scale}) translate(${-CARABINER_TIP.x} ${-CARABINER_TIP.y})` },
      svg("path", { d: CARABINER_OUTLINE, class: "map-pin-head", "vector-effect": "non-scaling-stroke" }),
      svg("path", { d: grouped ? CARABINER_GROUP_LINES : CARABINER_LINES, class: "map-pin-dot", "vector-effect": "non-scaling-stroke" })),
    ...(grouped
      ? [svg("text", { x: (CARABINER_RING.x - CARABINER_TIP.x) * scale, y: (CARABINER_RING.y - CARABINER_TIP.y) * scale + 4, class: "map-pin-count" }, String(pin.tieIds.length))]
      : []));
  el.addEventListener("click", () => pick(pin));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(pin, true); }
  });
  return el;
}

/**
 * A workshop's place: a teal diamond, so it reads apart from the ties' pins
 * by its shape as well as its color. Not grouped: there are few.
 * @param {WorkshopPlace} place
 * @param {(place: WorkshopPlace) => void} pick
 */
function workshopElement(place, pick) {
  const count = place.workshopIds.length;
  const label = `${place.label}: ${count} workshop${count === 1 ? "" : "s"}`;
  const el = svg("g", { class: "map-workshop", tabindex: 0, role: "button", "aria-label": label },
    svg("title", {}, label),
    svg("rect", { x: -6, y: -6, width: 12, height: 12, rx: 2, transform: "rotate(45)", class: "map-workshop-mark c-teal" }));
  el.addEventListener("click", () => pick(place));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(place); }
  });
  return el;
}

/**
 * @param {string} label
 * @param {string} id
 * @param {(Node | string)[]} content
 * @param {() => void} onclick
 */
function zoomButton(label, id, content, onclick) {
  return h("button", { type: "button", className: "icon-button map-button", id, "aria-label": label, title: label, onclick }, content);
}

/**
 * The map, fitted to the places (the workshops' too), with + and − and a
 * button to fit them again. Drag to move around. Stops watching its size
 * when `signal` aborts.
 * @param {{ places: Place[], onPick: (pin: Pin) => void, signal: AbortSignal,
 *   workshops?: WorkshopPlace[], onPickWorkshop?: (place: WorkshopPlace) => void }} options
 */
export function worldMap({ places, onPick, signal, workshops = [], onPickWorkshop = () => {} }) {
  const start = fitView([...places, ...workshops]);
  let view = start;

  const land = svg("svg", { class: "map-land", x: 0, y: 0, preserveAspectRatio: "none", "aria-hidden": "true" },
    svg("rect", { x: WORLD_VIEW.x, y: WORLD_VIEW.y, width: WORLD_VIEW.w, height: WORLD_VIEW.h, class: "map-sea" }),
    svg("path", { d: COUNTRIES, "fill-rule": "evenodd", class: "map-countries" }));
  const pinLayer = svg("g", { class: "map-pins" });
  // Under the ties' pins, which are what's mostly tapped.
  const workshopLayer = svg("g", { class: "map-workshops" });
  const workshopMarks = workshops.map((place) => ({ place, el: workshopElement(place, onPickWorkshop) }));
  workshopLayer.replaceChildren(...workshopMarks.map((w) => w.el));
  const map = svg("svg", { class: "map", focusable: "false" }, land, workshopLayer, pinLayer);

  const zoomIn = zoomButton("Zoom in", "map-zoom-in", ["+"], () => setView(zoomView(view, ZOOM_STEP)));
  const zoomOut = zoomButton("Zoom out", "map-zoom-out", ["−"], () => setView(zoomView(view, 1 / ZOOM_STEP)));
  const fit = zoomButton("Show all", "map-fit", [
    svg("svg", { viewBox: "0 0 24 24", class: "step-icon", "aria-hidden": "true", focusable: "false" },
      svg("path", { d: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" })),
  ], () => setView(start));
  const element = h("div", { className: "world-map", role: "group", "aria-label": "Map of the ties' locations" },
    map, h("div", { className: "map-zoom" }, zoomIn, zoomOut, fit));

  /** The pins' scale when they were last grouped: regrouped only on zoom. */
  let groupedAt = 0;
  /** @type {{ pin: Pin, el: SVGElement }[]} */
  let pins = [];
  let frame = 0;

  function draw() {
    frame = 0;
    const width = element.clientWidth;
    if (!width) return;
    const height = width / ASPECT;
    map.setAttribute("viewBox", `0 0 ${width} ${height}`);
    land.setAttribute("width", String(width));
    land.setAttribute("height", String(height));
    land.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
    const scale = width / view.w;
    if (scale !== groupedAt) {
      groupedAt = scale;
      pins = groupPlaces(places, PIN_GAP / scale).map((pin) => ({ pin, el: pinElement(pin, pick) }));
      pinLayer.replaceChildren(...pins.map((p) => p.el));
    }
    // Moving keeps the same pins (and which one has focus).
    for (const { pin, el } of [...pins, ...workshopMarks.map(({ place, el: mark }) => ({ pin: place, el: mark }))]) {
      el.setAttribute("transform", `translate(${((pin.x - view.x) * scale).toFixed(1)} ${((pin.y - view.y) * scale).toFixed(1)})`);
    }
    zoomIn.disabled = !canZoomIn(view);
    zoomOut.disabled = !canZoomOut(view);
  }

  /** Draws at the next frame, once however often it's asked. */
  function redraw() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  /** @param {View} next */
  function setView(next) {
    view = next;
    redraw();
  }

  // Dragging moves the map. Once a press has moved far enough to be a
  // drag, the map takes the pointer, so letting go over a pin doesn't
  // tap it.
  /** @type {{ id: number, x: number, y: number, view: View } | null} */
  let drag = null;
  let dragged = false;
  map.addEventListener("pointerdown", (e) => {
    if (drag || e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, view };
    dragged = false;
  });
  map.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragged) {
      if (Math.hypot(dx, dy) < DRAG_START) return;
      dragged = true;
      map.setPointerCapture(e.pointerId);
      element.classList.add("dragging");
    }
    const scale = element.clientWidth / drag.view.w;
    setView(panView(drag.view, -dx / scale, -dy / scale));
  });
  /** @param {PointerEvent} e */
  const endDrag = (e) => {
    if (drag?.id !== e.pointerId) return;
    drag = null;
    element.classList.remove("dragging");
  };
  map.addEventListener("pointerup", endDrag);
  map.addEventListener("pointercancel", endDrag);

  /**
   * A tap at the end of a drag isn't a tap.
   * @param {Pin} pin
   * @param {boolean} [keyboard]
   */
  function pick(pin, keyboard) {
    if (keyboard || !dragged) onPick(pin);
  }

  // Drawn once it's on the page and has a width, and again when that changes.
  const resize = new ResizeObserver(redraw);
  resize.observe(element);
  signal.addEventListener("abort", () => {
    resize.disconnect();
    if (frame) cancelAnimationFrame(frame);
  });
  return element;
}
