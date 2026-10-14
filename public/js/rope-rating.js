// Ratings drawn as rope hanks: tappable in the tie form, and small in the
// ties list. A hank is a grey outline until it's filled in the accent color.

import { h, privateField } from "./dom.js";
import { MAX_RATING, nextRating } from "./ties-view.js";

const SVG = "http://www.w3.org/2000/svg";

// A coiled hank: a long loop of rope (its outline and the hole through the
// middle, filled as one shape) with a few wraps round its waist.
const LOOP = "M12 2a6 6 0 0 1 6 6v8a6 6 0 0 1-12 0V8a6 6 0 0 1 6-6zM12 6a2 2 0 0 0-2 2v8a2 2 0 0 0 4 0V8a2 2 0 0 0-2-2z";
const WRAP_LINES = "M5.5 11h13M5.5 13h13";

/**
 * @param {string} tag
 * @param {Record<string, string>} attrs
 */
function svgElement(tag, attrs) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** One hank icon, hidden from screen readers (its button or text says what it means). */
function hankIcon() {
  const svg = svgElement("svg", { viewBox: "0 0 24 24", class: "hank", "aria-hidden": "true", focusable: "false" });
  svg.append(
    svgElement("path", { d: LOOP, class: "hank-loop", "fill-rule": "evenodd" }),
    svgElement("rect", { x: "5", y: "9", width: "14", height: "6", rx: "1.5", class: "hank-wrap" }),
    svgElement("path", { d: WRAP_LINES, class: "hank-wrap-lines" })
  );
  return svg;
}

/**
 * The tie form's rating: a row of hank buttons. Tapping the third fills
 * three; tapping the filled-in last one again clears the rating. The value
 * goes in a hidden input, so the form sends it with the rest.
 * @param {{ name: string, labelledBy: string }} config
 */
export function ratingPicker({ name, labelledBy }) {
  /** @type {number | null} */
  let rating = null;
  const input = privateField(h("input", { type: "hidden", name, value: "" }));
  const buttons = Array.from({ length: MAX_RATING }, (_, i) =>
    h("button", {
      type: "button", className: "hank-button", "aria-label": `${i + 1} of ${MAX_RATING}`,
      onclick: () => set(nextRating(rating, i + 1)),
    }, hankIcon()));

  /** @param {number | null} value */
  function set(value) {
    rating = value;
    input.value = value === null ? "" : String(value);
    buttons.forEach((button, i) => {
      const filled = value !== null && i < value;
      button.classList.toggle("filled", filled);
      button.setAttribute("aria-pressed", String(value === i + 1));
    });
  }
  set(null);

  return h("div", { className: "hank-picker", role: "group", "aria-labelledby": labelledBy }, buttons, input);
}

/**
 * A rating in the ties list: the hanks for the eye, the words for screen
 * readers (and for copying).
 * @param {number} rating
 * @param {string} text e.g. "4/5"
 */
export function ratingHanks(rating, text) {
  return h("span", { className: "hank-rating" },
    Array.from({ length: MAX_RATING }, (_, i) => {
      const icon = hankIcon();
      if (i < rating) icon.classList.add("filled");
      return icon;
    }),
    h("span", { className: "visually-hidden" }, text));
}
