// The poser's Scene tab (pose-editor.js): what's set once before posing,
// in two parts swapped with a switch like the tabs' own.
//
//   Hardpoint   a ring, bamboo or hashira, the one there pressed (tapping
//               it again takes it away, and tapping it once more puts it
//               back where it starts), and its sliders.
//   Body shape  its sliders, with Save as my model (what new poses start
//               with), Load default (the app's own body) and Reset (back
//               to my model, or the app's if I haven't saved one).
//
// The sliders themselves are the poser's (they change the pose), so it
// fills hardpointSliders and shapeSliders; this only builds the panel and
// keeps its buttons in step.

import { h } from "./dom.js";
import { HARDPOINTS } from "./pose-format.js";

/** @typedef {import("./pose-format.js").Hardpoint} Hardpoint */
/** @typedef {"hardpoint" | "shape"} Part */

/**
 * @param {{
 *   onHardpoint: (kind: Hardpoint) => void,
 *   onSaveShape: () => void,
 *   onLoadDefault: () => void,
 *   onResetShape: () => void,
 * }} actions
 */
export function scenePanel({ onHardpoint, onSaveShape, onLoadDefault, onResetShape }) {
  /** @type {Part} */
  let part = "hardpoint";
  /** @param {string} id @param {string} label @param {Part} which */
  const switchButton = (id, label, which) => h("button", {
    type: "button", className: "tool pose-switch-button", id, "aria-pressed": "false", onclick: () => show(which),
  }, label);
  const hardpointTab = switchButton("pose-scene-hardpoint", "Hardpoint", "hardpoint");
  const shapeTab = switchButton("pose-scene-shape", "Body shape", "shape");

  // The hardpoint there is pressed; tapping it again takes it away.
  const hardpointButtons = HARDPOINTS.map((kind) => h("button", {
    type: "button", className: "tool pose-chip", id: `pose-${kind}`, "aria-pressed": "false", onclick: () => onHardpoint(kind),
  }, kind));
  const hardpointSliders = h("div", { className: "pose-sliders pose-setting-box", id: "pose-hardpoint-sliders" });
  const hardpointPart = h("div", { className: "pose-scene-part", id: "pose-scene-part-hardpoint" },
    h("div", { className: "pose-chips", role: "group", "aria-label": "Hardpoint" }, hardpointButtons),
    hardpointSliders);

  const saveShapeButton = h("button", { type: "button", className: "tool", id: "pose-shape-default", onclick: onSaveShape }, "Save as my model");
  const loadDefaultButton = h("button", { type: "button", className: "tool", id: "pose-shape-load", onclick: onLoadDefault }, "Load default");
  const resetShapeButton = h("button", { type: "button", className: "tool", id: "pose-shape-reset", onclick: onResetShape }, "Reset");
  const shapeSliders = h("div", { className: "pose-sliders pose-setting-box", id: "pose-shape-sliders" });
  const shapePart = h("div", { className: "pose-scene-part", id: "pose-scene-part-shape", hidden: true },
    h("div", { className: "pose-shape-actions" }, saveShapeButton, loadDefaultButton, resetShapeButton),
    shapeSliders);

  const element = h("div", { className: "pose-panel", id: "pose-panel-scene", hidden: true },
    h("div", { className: "pose-switch", role: "group", "aria-label": "Scene" }, hardpointTab, shapeTab),
    hardpointPart, shapePart);

  /** @param {Part} which */
  function show(which) {
    part = which;
    hardpointTab.setAttribute("aria-pressed", String(part === "hardpoint"));
    shapeTab.setAttribute("aria-pressed", String(part === "shape"));
    hardpointPart.hidden = part !== "hardpoint";
    shapePart.hidden = part !== "shape";
  }
  show("hardpoint");

  /**
   * Keeps the buttons in step with the pose.
   * @param {{ hardpoint: Hardpoint | null, isDefault: boolean, isMine: boolean }} state
   *   isDefault: the body is the app's own; isMine: it's my saved model (the app's, when I haven't saved one)
   */
  function draw({ hardpoint, isDefault, isMine }) {
    for (const [i, button] of hardpointButtons.entries()) {
      const on = HARDPOINTS[i] === hardpoint;
      button.setAttribute("aria-pressed", String(on));
      button.title = `${on ? "Remove" : "Add"} ${HARDPOINTS[i]}`;
    }
    hardpointSliders.hidden = !hardpoint;
    // Nothing to do when it's already the body each would give.
    saveShapeButton.disabled = isMine;
    loadDefaultButton.disabled = isDefault;
    resetShapeButton.disabled = isMine;
  }

  return { element, hardpointSliders, shapeSliders, saveShapeButton, draw, show };
}
