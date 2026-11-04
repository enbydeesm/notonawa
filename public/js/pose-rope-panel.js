// The Rope tab's panel for the rope chosen (pose-editor.js), in place of
// the thickness and color tools while one is: a heading (its color, "Rope
// selected", then Move the body for a cinch or Runs free for a rope over
// the ring or bamboo and back (a see-saw), and ✕ to let it go), then Cinch, Slide and Add rope side by side, each an icon over its
// name, and one box under them for the one setting in play (its slack, its
// position along the bamboo while sliding, or a cinch's length). The one
// in use is pressed; tapping it again ends it.
//
// The settings' sliders are the poser's, so it hands them in.

import { h } from "./dom.js";
import { TOOL_ICONS } from "./tool-icons.js";

/** @typedef {import("./drawing-format.js").Color} Color */

/**
 * A checkbox with its label.
 * @param {string} id @param {string} label @param {boolean} checked @param {(on: boolean) => void} onchange @param {string} [className]
 */
export function checkbox(id, label, checked, onchange, className = "pose-check") {
  const box = h("input", { type: "checkbox", id, checked });
  box.addEventListener("change", () => onchange(box.checked));
  return h("label", { className, htmlFor: id }, box, label);
}

/**
 * @param {string} id @param {import("./tool-icons.js").ToolIcon} icon @param {string} label @param {string} title
 * @param {{ pressed?: boolean, disabled?: boolean, onclick: () => void }} state
 */
function actionButton(id, icon, label, title, { pressed = false, disabled = false, onclick }) {
  return h("button", {
    type: "button", className: "tool pose-action", id, title, "aria-pressed": String(pressed), disabled, onclick,
  }, TOOL_ICONS[icon](), h("span", {}, label));
}

/**
 * "Runs free": a rope over the ring or bamboo and back runs through it, so
 * pulling one end moves the other (a see-saw, pose-constraints.js).
 * @param {{ over: string, on: boolean, onChange: (on: boolean) => void }} seesaw
 */
function runsFree({ over, on, onChange }) {
  const label = checkbox("pose-seesaw", "Runs free", on, onChange, "pose-check pose-chosen-check");
  label.title = `Runs free over the ${over}: pulling one end moves the other`;
  return label;
}

/**
 * The chosen rope's panel, as its children.
 * @param {{
 *   color: Color,
 *   cinch: { still: boolean, onStill: (still: boolean) => void } | null,
 *   seesaw: { over: string, on: boolean, onChange: (on: boolean) => void } | null,
 *   slide: "none" | "off" | "on",
 *   settings: HTMLElement | null,
 *   onLetGo: () => void,
 *   onCinch: () => void,
 *   onSlide: () => void,
 *   onAddRope: () => void,
 * }} rope cinch: given when the rope is one (its "Move the body"); seesaw: given when it can
 *   run free over the ring or bamboo (over: which), pulling one end moving the other;
 *   slide: "none" when it isn't tied to the bamboo; settings: the box's slider
 * @returns {HTMLElement[]}
 */
export function chosenRopeView({ color, cinch, seesaw, slide, settings, onLetGo, onCinch, onSlide, onAddRope }) {
  const heading = h("div", { className: "pose-chosen-head" },
    h("span", { className: `pose-chosen-dot ink-${color}`, "aria-hidden": "true" }),
    h("h3", { className: "pose-part", id: "pose-chosen-title" }, "Rope selected"),
    cinch ? checkbox("pose-cinch-body", "Move the body", !cinch.still, (on) => cinch.onStill(!on), "pose-check pose-chosen-check") : null,
    seesaw ? runsFree(seesaw) : null,
    h("button", {
      type: "button", className: "tool icon-tool", id: "pose-rope-letgo", "aria-label": "Let go of this rope", title: "Let go of this rope",
      onclick: onLetGo,
    }, TOOL_ICONS.close()));
  const actions = h("div", { className: "pose-rope-actions", role: "group", "aria-label": "Rope actions" },
    actionButton("pose-cinch-start", "cinch", "Cinch",
      cinch ? "Done with the cinch" : "Tie a cinch from the dot, through uplines, ropes or the body",
      { pressed: !!cinch, onclick: onCinch }),
    slide === "none" ? null : actionButton("pose-along-start", "slide", "Slide", "Slide where it's tied along the bamboo",
      { pressed: slide === "on", disabled: !!cinch, onclick: onSlide }),
    actionButton("pose-added-start", "addRope", "Add rope", "Start a new rope tied on at the dot", { disabled: !!cinch, onclick: onAddRope }));
  return [
    heading,
    actions,
    settings ? h("div", { className: `pose-setting-box${cinch || slide === "on" ? " active" : ""}` }, settings) : null,
  ].filter((el) => el !== null);
}
