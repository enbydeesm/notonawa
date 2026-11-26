// The Rope tab's panel for the rope chosen (pose-editor.js), in place of
// the thickness and color tools while one is: a heading (its color, then
// Move the body for a cinch or Runs free for a rope over the ring or
// bamboo and back (a see-saw), the lock (shut and yellow while its lengths
// are locked, so moving the body keeps what it ties together; open while
// they're free), the eye (solid or see-through),
// Delete rope and ✕ to let it go), then Cinch, Slide and Add rope side by
// side, each an icon over its name, a row for the point chosen (Send
// backward, its layer, Bring forward, ‹ Add point › before or after it, and
// Remove point), and one box under them for the one setting in play (its
// length, its position along the bamboo while sliding, or a cinch's
// length). The one in use is pressed; tapping it again ends it. The point
// row is there whenever a rope is chosen, so it's clear it exists: with no
// point chosen (no dot tapped) its buttons are greyed out, and a tap on one
// says to select a point first.
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
 * @param {string} id @param {import("./tool-icons.js").ToolIcon} icon @param {string} title
 * @param {{ disabled?: boolean, onclick: () => void, className?: string }} state
 */
function iconButton(id, icon, title, { disabled = false, onclick, className = "" }) {
  return h("button", {
    type: "button", className: `tool icon-tool${className ? ` ${className}` : ""}`, id, "aria-label": title, title, disabled, onclick,
  }, TOOL_ICONS[icon]());
}

/** The highest layer (the format's LAYERS), here so this stays free of the poser's modules. */
const TOP_LAYER = 4;

/** How long "Select a point first" shows (ms). */
const TIP_MS = 2500;

/**
 * @typedef {{ chosen: boolean, layer: number, onLayer: (layer: number) => void,
 *   onBefore: (() => void) | null, onAfter: (() => void) | null, onRemove: () => void }} PointChoice
 *   chosen: whether a point is (its dot tapped); without one, the rest is unused
 */

/**
 * The point row: the chosen point's layer, ‹ Add point ›, and Remove point.
 * With no point chosen, its buttons are greyed out (`aria-disabled`, so
 * they still take a tap) and a tap shows "Select a point first" under it.
 * @param {PointChoice} point
 */
function pointRow({ chosen, layer, onLayer, onBefore, onAfter, onRemove }) {
  const tip = h("p", { className: "pose-point-tip", id: "pose-point-tip", role: "status", hidden: true }, "Select a point first");
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const sayChoose = () => {
    tip.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { tip.hidden = true; }, TIP_MS);
  };
  /**
   * @param {string} id @param {import("./tool-icons.js").ToolIcon} icon @param {string} title
   * @param {boolean} can @param {() => void} act @param {string} [className]
   */
  const button = (id, icon, title, can, act, className) => {
    const b = iconButton(id, icon, title, { disabled: chosen && !can, onclick: chosen ? act : sayChoose, className });
    if (!chosen) b.setAttribute("aria-disabled", "true");
    return b;
  };
  const row = h("div", { className: `pose-point-row${chosen ? "" : " unchosen"}`, id: "pose-point-row", role: "group", "aria-label": "The point chosen" },
    h("div", { className: "pose-point-layers" },
      button("pose-point-back", "backward", "Send backward (a layer in)", layer > 0, () => onLayer(layer - 1)),
      h("span", { className: "pose-point-layer", id: "pose-point-layer", "aria-live": "polite" }, `Layer ${chosen ? layer : "–"}`),
      button("pose-point-forward", "forward", "Bring forward (a layer out, over the ropes under it)", layer < TOP_LAYER, () => onLayer(layer + 1))),
    h("div", { className: "pose-point-add" },
      button("pose-point-before", "addBefore", "Add a point before this one", !!onBefore, () => onBefore?.()),
      // "Add point", or "+ point" where the row's narrow (app.css).
      h("span", { className: "pose-point-add-text", id: "pose-point-add-text" },
        h("span", { className: "pose-point-add-long" }, "Add point"), h("span", { className: "pose-point-add-short" }, "+ point")),
      button("pose-point-after", "addAfter", "Add a point after this one", !!onAfter, () => onAfter?.())),
    button("pose-point-remove", "removePoint", "Remove this point", true, onRemove, "danger-tool"),
    tip);
  return row;
}

/**
 * The chosen rope's panel, as its children.
 * @param {{
 *   color: Color,
 *   cinch: { still: boolean, onStill: ((still: boolean) => void) | null } | null,
 *   seesaw: { over: string, on: boolean, onChange: (on: boolean) => void } | null,
 *   slide: "none" | "off" | "on",
 *   settings: HTMLElement | null,
 *   onLetGo: () => void,
 *   onCinch: () => void,
 *   onSlide: () => void,
 *   onAddRope: () => void,
 *   seeThrough?: { on: boolean, onChange: (on: boolean) => void },
 *   onDelete?: () => void,
 *   lock?: { on: boolean, onChange: (on: boolean) => void },
 *   point?: PointChoice | null,
 * }} rope cinch: given when the rope is one (its "Move the body", shown when onStill
 *   is given: a cinch on uplines, not one only round the body); seesaw: given when it can
 *   run free over the ring or bamboo (over: which), pulling one end moving the other;
 *   slide: "none" when it isn't tied to the bamboo; settings: the box's slider
 * @returns {HTMLElement[]}
 */
export function chosenRopeView({ color, cinch, seesaw, slide, settings, onLetGo, onCinch, onSlide, onAddRope, seeThrough, onDelete, lock, point = null }) {
  const heading = h("div", { className: "pose-chosen-head" },
    h("span", { className: `pose-chosen-dot ink-${color}`, "aria-hidden": "true" }),
    // Named for screen readers only: the dot shows which rope it is.
    h("h3", { className: "pose-part visually-hidden", id: "pose-chosen-title" }, "Rope selected"),
    // Its checkboxes: on a narrow screen, a line of their own under the buttons (app.css).
    h("div", { className: `pose-chosen-checks${cinch?.onStill ? " long" : ""}` },
      cinch?.onStill ? checkbox("pose-cinch-body", "Move the body", !cinch.still, (on) => cinch.onStill?.(!on), "pose-check pose-chosen-check") : null,
      seesaw ? runsFree(seesaw) : null),
    lock ? h("button", {
      type: "button", className: "tool icon-tool", id: "pose-rope-lock", "aria-pressed": String(lock.on),
      "aria-label": lock.on ? "Lengths locked: unlock" : "Lock its lengths",
      title: lock.on ? "Lengths locked, so what it ties stays together: tap to let them change" : "Lock its lengths, so what it ties stays together as the body moves",
      onclick: () => lock.onChange(!lock.on),
    }, TOOL_ICONS[lock.on ? "locked" : "unlocked"]()) : null,
    seeThrough ? h("button", {
      type: "button", className: "tool icon-tool", id: "pose-rope-see-through", "aria-pressed": String(seeThrough.on),
      "aria-label": seeThrough.on ? "See-through: make it solid" : "Make it see-through",
      title: seeThrough.on ? "See-through: tap to make it solid" : "Make it see-through, to see the ropes under it",
      onclick: () => seeThrough.onChange(!seeThrough.on),
    }, TOOL_ICONS[seeThrough.on ? "seeThrough" : "seen"]()) : null,
    onDelete ? iconButton("pose-rope-delete", "trash", "Delete this rope", { onclick: onDelete, className: "danger-tool" }) : null,
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
    point ? pointRow(point) : null,
    settings ? h("div", { className: `pose-setting-box${cinch || slide === "on" ? " active" : ""}` }, settings) : null,
  ].filter((el) => el !== null);
}
