// The welcome tour: a welcome card, then a ring round each of the nav's
// icons in turn with a card under the nav saying what it's for, then
// Account Recovery and "That's a wrap!" (tour-steps.js has the words).
// Shown once after unlocking until it's finished or skipped (the account's
// hide_welcome, kept from the welcome it replaced), and again from the
// menu's Tutorial whenever I like.
//
// One modal dialog over the whole window: the app under it can't be used
// while it's open, and Esc is Skip tour. The dim, its hole round the icon,
// the ring and the pointer are SVG drawn from the icon's place on screen
// (tour-layout.js), so they follow the nav at any width without a style
// attribute (the CSP refuses those). Drawn again when the window changes
// size.

import { h } from "./dom.js";
import { STOPS, FINISH, stepAt, COFFEE_URL, CONTACT_EMAIL } from "./tour-steps.js";
import { ringFor, sideFor, pointerX, pointerPoints } from "./tour-layout.js";
import { loadSettings, saveTourSeen } from "./settings.js";

const SVG = "http://www.w3.org/2000/svg";

/**
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 */
function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
}

/** @param {import("./tour-steps.js").Span} span */
function renderSpan(span) {
  return typeof span === "string" ? span : h("em", {}, span.em);
}

/**
 * How the tour ended: "done" (Done on the wrap-up), "skipped" (Skip tour,
 * or Esc), or "closed" (closed by something else, e.g. the view changing,
 * which closes every dialog).
 * @typedef {"done" | "skipped" | "closed"} TourEnd
 */

/**
 * Opens the tour at its welcome. Resolves with how it ended.
 * @returns {Promise<TourEnd>}
 */
export function openTour() {
  return new Promise((resolve) => {
    /** @type {TourEnd} */ let ending = "closed";
    let step = 0;

    // The dim with its hole and ring, under the card; the pointer, over it
    // (so it covers the card's border where they join).
    const hole = svg("rect", { rx: 10, fill: "black" });
    const mask = svg("mask", { id: "tour-hole" });
    mask.append(svg("rect", { x: 0, y: 0, width: "100%", height: "100%", fill: "white" }), hole);
    const shade = svg("rect", { class: "tour-shade", x: 0, y: 0, width: "100%", height: "100%", mask: "url(#tour-hole)" });
    const ring = svg("rect", { class: "tour-ring", rx: 10 });
    const dim = svg("svg", { class: "tour-dim", "aria-hidden": "true" });
    const defs = svg("defs");
    defs.append(mask);
    dim.append(defs, shade, ring);
    const pointerFill = svg("polygon", { class: "tour-pointer-fill" });
    const pointerEdge = svg("polyline", { class: "tour-pointer-edge" });
    const pointer = svg("svg", { class: "tour-pointer", "aria-hidden": "true" });
    pointer.append(pointerFill, pointerEdge);

    const card = h("section", { className: "tour-card", "aria-labelledby": "tour-heading" });
    const dialog = h("dialog", { className: "tour", "aria-labelledby": "tour-heading" }, dim, card, pointer);

    /** @param {TourEnd} how */
    const end = (how) => { ending = how; dialog.close(); };
    /** @param {number} to */
    const go = (to) => { step = to; draw(); };

    const skipButton = () => h("button", { type: "button", className: "link tour-skip", onclick: () => end("skipped") }, "Skip tour");

    /** The card for this step, its buttons, and focus on the way on. */
    function draw() {
      const at = stepAt(step);
      /** @type {HTMLButtonElement} */ let next;
      if (at.kind === "welcome") {
        next = h("button", { type: "button", className: "primary", id: "tour-start", onclick: () => go(1) }, "Start the tour");
        card.className = "tour-card centered tour-welcome";
        card.replaceChildren(
          h("span", { className: "tour-mark", "aria-hidden": "true" }),
          h("h2", { id: "tour-heading" }, "Welcome to NōtoNawa"),
          h("p", {}, "Your end-to-end encrypted planner and journal for your rope practice."),
          h("p", {}, "Let's take a quick tour."),
          next,
          h("div", { className: "tour-later" },
            skipButton(),
            h("p", { className: "hint" }, "You can replay it any time from", h("br"), "Menu > Tutorial.")));
      } else if (at.kind === "finish") {
        next = h("button", { type: "button", className: "primary", id: "tour-done", onclick: () => end("done") }, "Done");
        card.className = "tour-card centered tour-finish";
        card.replaceChildren(
          h("h2", { id: "tour-heading" }, "That's a wrap!"),
          h("p", {}, "If you have questions, feedback or ideas to share, we'd love to hear from you! "
            + "Use the feedback button in the menu or email us at ",
          h("a", { href: `mailto:${CONTACT_EMAIL}` }, CONTACT_EMAIL), "."),
          next,
          h("button", { type: "button", className: "link tour-back", onclick: () => go(FINISH - 1) }, "Back"),
          h("p", { className: "hint tour-coffee" },
            "NōtoNawa is a solo ", h("s", {}, "obsession"), " project; if you'd like to help us cover hosting, feel free to ",
            h("a", { href: COFFEE_URL, target: "_blank", rel: "noopener noreferrer" }, "buy us a coffee.")));
      } else {
        const { stop, count, last } = at;
        next = h("button", { type: "button", className: "primary tour-next", onclick: () => go(at.step + 1) }, last ? "Finish" : "Next");
        card.replaceChildren(
          h("div", { className: "tour-title-row" },
            h("h2", { id: "tour-heading" }, stop.title),
            h("span", { className: "hint tour-count" }, count)),
          h("div", { className: "tour-body", "aria-live": "polite" },
            stop.body.map((spans) => h("p", {}, spans.map(renderSpan)))),
          h("progress", { className: "tour-progress", max: STOPS.length, value: at.step, "aria-label": "Tour progress" }),
          h("div", { className: "tour-buttons" },
            skipButton(),
            h("button", { type: "button", className: "tour-back", onclick: () => go(at.step - 1) }, "Back"),
            next));
      }
      place();
      next.focus();
    }

    /** The hole, ring and pointer round this step's icon (none in the middle). */
    function place() {
      const at = stepAt(step);
      const target = at.kind === "stop" && at.stop.target ? document.querySelector(at.stop.target) : null;
      const view = { width: window.innerWidth, height: window.innerHeight };
      const spot = ringFor(target ? target.getBoundingClientRect() : null, view);
      // A stop's card goes under the nav, lined up with the nav's edge
      // nearer its icon, pointing up at it; with nothing to point at
      // (Account Recovery, or the nav hidden), in the middle.
      if (at.kind === "stop") card.className = spot ? `tour-card at-nav ${sideFor(spot, view.width)}` : "tour-card centered tour-note";
      for (const el of [hole, ring]) {
        el.setAttribute("x", String(spot?.left ?? 0));
        el.setAttribute("y", String(spot?.top ?? 0));
        el.setAttribute("width", String(spot?.width ?? 0));
        el.setAttribute("height", String(spot?.height ?? 0));
      }
      ring.toggleAttribute("hidden", !spot);
      pointer.toggleAttribute("hidden", !spot);
      if (!spot) return;
      const box = card.getBoundingClientRect();
      const { fill, edge } = pointerPoints(pointerX(spot, box), box.top);
      pointerFill.setAttribute("points", fill);
      pointerEdge.setAttribute("points", edge);
    }

    const resized = new AbortController();
    window.addEventListener("resize", () => place(), { signal: resized.signal });
    dialog.addEventListener("cancel", () => { ending = "skipped"; });
    dialog.addEventListener("close", () => {
      resized.abort();
      dialog.remove();
      resolve(ending);
    });
    document.body.append(dialog);
    dialog.showModal();
    draw();
  });
}

/**
 * Shows the tour unless I've already finished or skipped it, and remembers
 * that I have. Closed some other way (the view changed under it), it shows
 * again after the next unlock.
 */
export async function showTourOnce() {
  const { hide_welcome: seen } = await loadSettings();
  if (seen) return;
  if ((await openTour()) !== "closed") await saveTourSeen();
}
