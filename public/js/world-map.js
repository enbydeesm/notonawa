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
import {
  ASPECT, WORLD_VIEW, ZOOM_STEP, fitView, zoomView, panView, canZoomIn, canZoomOut, groupPlaces,
} from "./map-geo.js";

/**
 * @typedef {import("./map-geo.js").Place} Place
 * @typedef {import("./map-geo.js").Pin} Pin
 * @typedef {import("./map-geo.js").View} View
 */

/** Pins nearer than this many pixels are grouped. */
const PIN_GAP = 30;
/** A drag shorter than this many pixels is a tap. */
const DRAG_START = 5;

/**
 * A pin's outline, its point at 0, 0 and its round head `height` above.
 * @param {number} r the head's radius
 * @param {number} height
 */
function pinPath(r, height) {
  const cy = -(height - r);
  return `M0 0C${-r * 0.35} ${cy * 0.5} ${-r} ${cy + r * 0.6} ${-r} ${cy}A${r} ${r} 0 1 1 ${r} ${cy}`
    + `C${r} ${cy + r * 0.6} ${r * 0.35} ${cy * 0.5} 0 0Z`;
}
const PLACE_PIN = { r: 8, height: 26 };
const GROUP_PIN = { r: 11, height: 32 };

/**
 * One pin: a button for keyboards and screen readers too. A group shows
 * how many ties it has.
 * @param {Pin} pin
 * @param {(pin: Pin, keyboard?: boolean) => void} pick
 */
function pinElement(pin, pick) {
  const grouped = pin.places.length > 1;
  const { r, height } = grouped ? GROUP_PIN : PLACE_PIN;
  const label = `${pin.label}: ${tiesWord(pin.tieIds.length)}`;
  const el = svg("g", { class: grouped ? "map-pin grouped" : "map-pin", tabindex: 0, role: "button", "aria-label": label },
    svg("title", {}, label),
    svg("path", { d: pinPath(r, height), class: "map-pin-head" }),
    grouped
      ? svg("text", { x: 0, y: -(height - r) + 4, class: "map-pin-count" }, String(pin.tieIds.length))
      : svg("circle", { cx: 0, cy: -(height - r), r: 3, class: "map-pin-dot" }));
  el.addEventListener("click", () => pick(pin));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(pin, true); }
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
 * The map, fitted to the places, with + and − and a button to fit them
 * again. Drag to move around. Stops watching its size when `signal` aborts.
 * @param {{ places: Place[], onPick: (pin: Pin) => void, signal: AbortSignal }} options
 */
export function worldMap({ places, onPick, signal }) {
  const start = fitView(places);
  let view = start;

  const land = svg("svg", { class: "map-land", x: 0, y: 0, preserveAspectRatio: "none", "aria-hidden": "true" },
    svg("rect", { x: WORLD_VIEW.x, y: WORLD_VIEW.y, width: WORLD_VIEW.w, height: WORLD_VIEW.h, class: "map-sea" }),
    svg("path", { d: COUNTRIES, "fill-rule": "evenodd", class: "map-countries" }));
  const pinLayer = svg("g", { class: "map-pins" });
  const map = svg("svg", { class: "map", focusable: "false" }, land, pinLayer);

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
    for (const { pin, el } of pins) {
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
