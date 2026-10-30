// The poser: a dialog filling the screen, over the form it was opened from
// (a separate view would close that form), as the drawing pad is. It shows
// the figure in 3D (pose-scene.js) with two ways of working:
//
//   Pose  tap a body part, then move it with the sliders below, or drag
//         an arm or a leg by any part of it (pose-ik.js: the joints above
//         the part held turn to follow the finger); the hips
//         move the whole body (tipping it over, turning it, lifting it,
//         moving it across and front to back), and the head has the
//         lifting and moving too.
//         A starting position for the body, and one for the arms (each
//         keeping the other), or a quick turn of the whole body, from the
//         menus. The body and arms menus also have my saved presets, and
//         save the position now as one (pose-presets.js: the account's own,
//         for every pose).
//   Rope  tap the body, point after point, to lay a rope; tap the
//         hardpoint (a ring or bamboo for uplines, or a hashira to tie
//         to). "Finish rope" ends one. The eraser takes out the rope
//         tapped. One hardpoint at a time can be added, moved and taken
//         away (a bamboo's length and where its lines hang from too).
//         Tapping a rope chooses it: a rope over the ring or bamboo and
//         back can be a see-saw (pose-constraints.js: moving one end
//         moves the other); "Cinch from here" ties a cinch from where it
//         was tapped to the next upline, rope or body part tapped, and a
//         cinch chosen has its length, shortening it pulling the upline
//         aside (pose-cinch.js), and the body with it if "Move the body"
//         is ticked.
//   Pencil  draw over the view, flat on the screen (pose-marks.js): the
//         marks go in the pictures, aren't saved with the pose, and hide
//         when the view turns. Fingers only draw here, so it can't turn.
//
// One finger dragging anywhere else turns the view round the figure; two pinch to zoom
// and drag to pan. Sliders work as a phone's touch would want, with a
// finger, rather than dragging handles in 3D, each with ▲ and ▼ beside
// its box to step it by one. "Add to visuals" puts a
// picture of the view so far into the item's visuals, as a photo; the
// download button saves the same picture to the device.
//
// Undo and redo go back over everything since the poser opened, except the
// view. Nothing else is saved here: editPose resolves with the new pose,
// and the Visuals section saves it.

import { h, showMessage, privateField } from "./dom.js";
import { capitalise, today } from "./format.js";
import { choose } from "./dialog.js";
import {
  PART_LABELS, startJoints, BODY_PRESETS, ARMS_PRESETS, ORIENTATIONS, BODY_MOVES, LIFT_RANGE, jointNamed, withArmsPreset,
} from "./figure-rig.js";
import { pickPreset, pickTurn } from "./preset-picker.js";
import {
  COLORS, WIDTHS, HARDPOINTS, HARDPOINT_RANGES, SHIFT_RANGE, RING_POINT, newPose, readPose, setJoint, setBody, setLift, setShift,
  setCamera, panCamera, typedNumber, clamp, maxInset,
  hardpointOf, setHardpoint, moveHardpoint, hardpointPointsLost, bambooPoint, hashiraPoint,
  bonePoint, addPoint, finishRope, removeRope, cantAdd, withPosture, startHistory, change, look, undo, redo,
  isCinch, isUpline, canSeesaw, setSeesaw, cinchOn, cantCinch, addCinch, setCinchLength, ropeSpot, forSaving, moveAlongBamboo,
} from "./pose-format.js";
import { poseView, poseImage } from "./pose-scene.js";
import { SHAPE_RANGES, SHAPE_SLIDERS, DEFAULT_SHAPE, standingLift, sameShape } from "./figure-body.js";
import { loadSettings, saveDefaultShape } from "./settings.js";
import { canDrag, dragTo, onPlane, DRAG_CHAINS } from "./pose-ik.js";
import { makeSkeleton, posed, withShape, withBodyPresetOn, onDefaultBody } from "./pose-skeleton.js";
import { keepAwake } from "./wake-lock.js";
import { depths, clashingParts, settleClashes, behindBody } from "./pose-contact.js";
import { cinchEnds, spotOn } from "./pose-cinch.js";
import { cinchBody, keepSeesaws } from "./pose-constraints.js";
import { toViewUnits, marksShow, addMark, markAt } from "./pose-marks.js";
import { marksLayer, withMarks } from "./pose-marks-ui.js";
import { TOOL_ICONS } from "./tool-icons.js";
import { saveFile } from "./download.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./pose-format.js").Rope} Rope */
/** @typedef {import("./drawing-format.js").Color} Color */
/** @typedef {import("./drawing-format.js").Width} Width */
/** @typedef {import("./figure-rig.js").BodyPreset} BodyPreset */
/** @typedef {import("./figure-body.js").Shape} Shape */
/** @typedef {import("./figure-rig.js").ArmsPreset} ArmsPreset */
/** @typedef {import("./pose-format.js").RopePoint} RopePoint */
/** @typedef {import("./drawing-format.js").Stroke} Stroke */

const WIDTH_NAMES = /** @type {const} */ ({ 1: "Thin", 2: "Medium", 3: "Thick" });
/** Quick views: [yaw, pitch], keeping the distance and height. */
const VIEWS = /** @type {const} */ ([["Front", 0, 8], ["Left side", 90, 8], ["Back", 180, 8], ["Right side", -90, 8], ["Above", 25, 70]]);
/** Points closer than this (view units) to the last one aren't added to a pencil mark. */
const MARK_STEP = 2;
/** How far a pointer moves (CSS px) before a tap becomes a drag. */
const DRAG_START = 8;
/** The view's height in the room per CSS px of the canvas, at a distance of 1 (its 38° field of view). */
const PAN_PER_PX = 2 * Math.tan(19 * Math.PI / 180);

/** The downloaded picture's size, as the visuals' full-size picture of a pose (poses-ui.js). */
const PICTURE = { width: 900, height: 1200, type: "image/png" };
/** The whole figure's shift sliders, in the order of its numbers. */
const SHIFT_SLIDERS = /** @type {const} */ (["Across (cm)", "Front to back (cm)"]);

/** Each hardpoint's sliders: their labels, in the order of its numbers. */
const HARDPOINT_SLIDERS = /** @type {const} */ ({
  ring: ["Across (cm)", "Height (cm)", "Front to back (cm)"],
  bamboo: ["Across (cm)", "Height (cm)", "Front to back (cm)", "Turn", "Length (cm)", "Hanger inset (cm)"],
  hashira: ["Across (cm)", "Front to back (cm)", "Turn"],
});

// The last rope color and width chosen, kept while the page is open.
/** @type {Color} */
let lastColor = "red";
/** @type {Width} */
let lastWidth = 2;

/**
 * Opens the poser on a pose (or a new one, standing, in the account's
 * default body if one's saved).
 * @param {Pose | null} start
 * @param {{ addToVisuals?: (picture: Blob) => Promise<void> }} [options] addToVisuals:
 *   puts a picture of the pose (a PNG) into the item's visuals (the button's left out without it)
 * @returns {Promise<Pose | null>} the new pose, or null if cancelled
 */
export async function editPose(start, { addToVisuals } = {}) {
  /** The body new poses start with (null: the in-between one). @type {Shape | null} */
  let defaultShape = (await loadSettings().catch(() => null))?.default_shape ?? null;
  const fresh = () => (defaultShape ? withShape(makeSkeleton(), newPose(), defaultShape) : newPose());
  return new Promise((resolve) => {
    let history = startHistory(start ? readPose(start) : fresh());
    /** A slider being dragged: its pose, not yet a change (it is when let go). @type {Pose | null} */
    let draft = null;
    /** @type {"pose" | "rope" | "draw"} */
    let mode = "pose";
    /** The part being posed. @type {string | null} */
    let selected = null;
    /** The rope being laid. @type {Rope | null} */
    let laying = null;
    let erasing = false;
    /** The rope chosen (tapped in Rope mode), and where on it. @type {{ index: number, segment: number, along: number } | null} */
    let chosen = null;
    /** A cinch being tied: its first end, waiting for the second. @type {RopePoint | null} */
    let cinching = null;
    /**
     * "Move along bamboo": the chosen rope's point on the bamboo being slid
     * along it, which its one slider shows in place of the bamboo's.
     * @type {{ index: number, point: number } | null}
     */
    let sliding = null;
    /** The pencil's eraser is on. */
    let erasingMarks = false;
    /** The skeleton the poser measures ropes with (the view has its own). */
    const measuring = makeSkeleton();
    /** @type {Color} */
    let color = lastColor;
    /** @type {Width} */
    let width = lastWidth;
    /** @type {Pose | null} */
    let result = null;

    const current = () => draft ?? history.pose;

    const view = poseView();
    view.canvas.id = "pose-view";
    view.canvas.className = "pose-canvas";
    view.canvas.setAttribute("role", "img");
    view.canvas.setAttribute("aria-label", "The figure: drag to turn the view, two fingers to pan, pinch to zoom, tap a part to pose it");

    const message = h("p", { className: "message", id: "pose-message", "aria-live": "polite" });
    /** @param {string} text @param {boolean} [isError] */
    const say = (text, isError = false) => showMessage(message, text, isError);

    // --- the toolbar -----------------------------------------------------------

    /**
     * @param {string} id @param {string} label @param {string} className
     * @param {() => void} onclick @param {...any} children
     */
    const toggle = (id, label, className, onclick, ...children) => h("button", {
      type: "button", id, className: `tool ${className}`.trim(), "aria-label": label, title: label, "aria-pressed": "false", onclick,
    }, ...children);
    const poseTab = toggle("pose-mode-pose", "Pose the figure", "", () => setMode("pose"), "Pose");
    const ropeTab = toggle("pose-mode-rope", "Lay ropes", "", () => setMode("rope"), "Rope");
    const drawTab = toggle("pose-mode-draw", "Draw over the view", "icon-tool", () => setMode("draw"), TOOL_ICONS.pencil());
    /**
     * A button showing an icon, its name in aria-label and title.
     * @param {string} id @param {string} label @param {import("./tool-icons.js").ToolIcon} kind @param {() => void} onclick
     */
    const iconButton = (id, label, kind, onclick) => h("button", {
      type: "button", className: "tool icon-tool", id, "aria-label": label, title: label, onclick,
    }, TOOL_ICONS[kind]());
    const undoButton = iconButton("pose-undo", "Undo", "undo", doUndo);
    const redoButton = iconButton("pose-redo", "Redo", "redo", doRedo);
    const downloadButton = iconButton("pose-download", "Download picture", "download", download);
    const addVisualButton = addToVisuals
      ? h("button", { type: "button", className: "tool", id: "pose-add-visual", onclick: addPicture }, "Add to visuals") : null;
    const viewMenu = h("select", { id: "pose-view-choice", className: "tool pose-view-menu", "aria-label": "View from", onchange: () => {
      const chosen = VIEWS[Number(viewMenu.value)];
      viewMenu.value = "";
      if (!chosen) return;
      const [, yaw, pitch] = chosen;
      const [, , distance, height, x, z] = current().camera;
      lookAt([yaw, pitch, distance, height, x, z]);
    } }, h("option", { value: "" }, "View"), VIEWS.map(([name], i) => h("option", { value: String(i) }, name)));
    // The hint top left, the views top right, over the 3D view and its
    // pencil marks.
    const marks = marksLayer();
    const frame = h("div", { className: "pose-frame" }, view.canvas, marks.svg,
      h("p", { className: "pose-hint", "aria-hidden": "true" }, "Drag to turn · 2 fingers to pan · pinch to zoom"),
      viewMenu);

    // --- the Pose panel ----------------------------------------------------------

    // The pickers for the body's and arms' presets, and where the body
    // faces (preset-picker.js).
    /** @type {(kind: "body" | "arms") => void} */
    // A body preset's height is for the default body, so the body's turned
    // into that to compare and save, and a preset put on it the same way
    // (pose-skeleton.js): Standing stands on the floor whatever the height.
    const openPresets = (kind) => pickPreset({
      kind, builtIn: kind === "body" ? BODY_PRESETS : ARMS_PRESETS,
      posture: () => (kind === "body" ? onDefaultBody(measuring, history.pose) : history.pose),
      apply: (preset) => commit(kind === "body"
        ? withBodyPresetOn(measuring, history.pose, /** @type {BodyPreset} */ (preset))
        : withPosture(history.pose, withArmsPreset(history.pose, /** @type {ArmsPreset} */ (preset)))),
    });
    const pickerButton = (/** @type {string} */ id, /** @type {string} */ label, /** @type {() => void} */ onclick) =>
      h("button", { type: "button", className: "tool pose-picker", id, "aria-haspopup": "dialog", onclick }, label);
    const bodyButton = pickerButton("pose-body-preset", "Body…", () => openPresets("body"));
    const armsButton = pickerButton("pose-arms-preset", "Arms…", () => openPresets("arms"));
    const turnButton = pickerButton("pose-orientation", "Turn body…", () => pickTurn({
      orientations: ORIENTATIONS, body: history.pose.body, apply: (body) => commit({ ...history.pose, body: /** @type {[number, number, number]} */ (body) }),
    }));
    const partName = h("h3", { className: "pose-part", id: "pose-part" });
    const sliders = h("div", { className: "pose-sliders", id: "pose-sliders" });
    const resetPart = h("button", { type: "button", className: "tool", id: "pose-reset-part", onclick: resetSelected }, "Reset");
    // The body's shape, folded away until wanted, with "Save as my
    // default" in the middle of its heading's row and Reset at its end
    // (beside the fold, not in it, so they show folded).
    const shapeSliders = h("div", { className: "pose-sliders", id: "pose-shape-sliders" });
    const saveShapeButton = h("button", {
      type: "button", className: "tool pose-shape-save", id: "pose-shape-default", onclick: saveShapeAsDefault,
    }, "Save as my default");
    // Back to the app's own body; my saved default stays as it is.
    const resetShapeButton = h("button", {
      type: "button", className: "tool pose-shape-reset", id: "pose-shape-reset",
      onclick: () => commit(withShape(measuring, history.pose, DEFAULT_SHAPE)),
    }, "Reset");
    const shapeFold = h("div", { className: "pose-shape" },
      h("details", { className: "fold", id: "pose-shape" }, h("summary", {}, "Body shape"), shapeSliders),
      h("div", { className: "pose-shape-actions" }, saveShapeButton, resetShapeButton));

    /** Saves the body shown as the one new poses start with. */
    async function saveShapeAsDefault() {
      const shape = /** @type {Shape} */ ([...current().shape]);
      saveShapeButton.disabled = true;
      try {
        await saveDefaultShape(shape);
        defaultShape = shape;
        say("Saved. New poses will start with this body.");
      } catch (err) {
        say(`Couldn't save the default body: ${err instanceof Error ? err.message : "try again"}`, true);
      }
      drawShapePanel();
    }
    // The part's name, with Reset at the end of the same row.
    const posePanel = h("div", { className: "pose-panel", id: "pose-panel-pose" },
      h("div", { className: "pose-menus" }, bodyButton, armsButton, turnButton),
      shapeFold,
      h("div", { className: "pose-part-row" }, partName, resetPart), sliders);

    // --- the Rope panel ----------------------------------------------------------

    const colorButtons = COLORS.map((c) => toggle(`pose-color-${c}`, capitalise(c), `swatch-tool ink-${c}`, () => pickColor(c),
      h("span", { className: "swatch-dot", "aria-hidden": "true" })));
    const widthButtons = WIDTHS.map((w) => toggle(`pose-width-${w}`, WIDTH_NAMES[w], "width-tool", () => pickWidth(w),
      h("span", { className: `width-sample width-${w}`, "aria-hidden": "true" })));
    const eraserButton = toggle("pose-eraser", "Eraser: tap a rope to take it out", "", () => setErasing(!erasing), "Eraser");
    const finishButton = h("button", { type: "button", className: "pose-finish", id: "pose-finish-rope", onclick: () => { endRope(); drawAll(); } }, "Finish rope");
    // The pose's hardpoint is pressed (tapping it again takes it away).
    const hardpointButtons = HARDPOINTS.map((kind) => h("button", {
      type: "button", className: "tool", id: `pose-${kind}`, "aria-pressed": "false", onclick: () => toggleHardpoint(kind),
    }, kind));
    const hardpointSliders = h("div", { className: "pose-sliders", id: "pose-hardpoint-sliders" });
    const ropeHint = h("p", { className: "hint", id: "pose-rope-hint" });
    // The rope chosen: a see-saw's box, Cinch from here, a cinch's length.
    const ropeOptions = h("div", { className: "pose-rope-options", id: "pose-rope-options" });
    const ropePanel = h("div", { className: "pose-panel", id: "pose-panel-rope", hidden: true },
      h("div", { className: "tool-group pose-rope-tools", role: "group", "aria-label": "Rope thickness" }, widthButtons, eraserButton, finishButton),
      h("div", { className: "tool-group", role: "group", "aria-label": "Rope color" }, colorButtons),
      ropeHint,
      ropeOptions,
      h("div", { className: "tool-group", role: "group", "aria-labelledby": "pose-hardpoint-label" },
        h("span", { className: "pose-row-label", id: "pose-hardpoint-label" }, "Hardpoint:"), hardpointButtons),
      hardpointSliders);

    // --- the Pencil panel ---------------------------------------------------------

    // The same colors and widths as ropes, with an eraser of its own.
    const markColorButtons = COLORS.map((c) => toggle(`pose-mark-color-${c}`, capitalise(c), `swatch-tool ink-${c}`, () => pickColor(c),
      h("span", { className: "swatch-dot", "aria-hidden": "true" })));
    const markWidthButtons = WIDTHS.map((w) => toggle(`pose-mark-width-${w}`, WIDTH_NAMES[w], "width-tool", () => pickWidth(w),
      h("span", { className: `width-sample width-${w}`, "aria-hidden": "true" })));
    const markEraserButton = toggle("pose-mark-eraser", "Eraser: tap or drag over a mark to take it out", "",
      () => setErasingMarks(!erasingMarks), "Eraser");
    const drawPanel = h("div", { className: "pose-panel", id: "pose-panel-draw", hidden: true },
      h("div", { className: "tool-group", role: "group", "aria-label": "Line width" }, markWidthButtons, markEraserButton),
      h("div", { className: "tool-group", role: "group", "aria-label": "Line color" }, markColorButtons),
      h("p", { className: "hint", id: "pose-draw-hint" },
        "Draw over the view with a finger. The marks go into the pictures Add to visuals and Download make, aren't saved " +
        "with the pose, and hide when the view turns."));

    // The panels scroll when they're taller than their space: their bottom
    // edge fades while there's more below, so it's clear there is.
    const panels = h("div", { className: "pose-panels", id: "pose-panels" }, posePanel, ropePanel, drawPanel);
    const fadePanels = () => panels.classList.toggle("more-below", panels.scrollTop + panels.clientHeight < panels.scrollHeight - 2);
    panels.addEventListener("scroll", fadePanels, { passive: true });

    const dialog = h("dialog", { className: "pose-editor", "aria-labelledby": "pose-heading" },
      h("h2", { id: "pose-heading", className: "visually-hidden" }, start ? "Edit pose" : "New pose"),
      h("div", { className: "pose-tools" },
        h("div", { className: "tool-group", role: "group", "aria-label": "Mode" }, poseTab, ropeTab, drawTab),
        h("div", { className: "tool-group" }, undoButton, redoButton, downloadButton),
        addVisualButton),
      frame,
      panels,
      message,
      h("div", { className: "drawing-actions" },
        h("button", { type: "button", id: "pose-cancel", onclick: cancel }, "Cancel"),
        h("button", { type: "button", className: "primary", id: "pose-save", onclick: save }, "Save pose")));

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancel();
    });
    dialog.addEventListener("close", () => {
      letSleep();
      resized.disconnect();
      view.dispose();
      dialog.remove();
      resolve(result);
    });
    dialog.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) doRedo();
      else doUndo();
    });

    // --- drawing ---------------------------------------------------------------

    /** The depths of the pose a move starts from (pose-contact.js), worked out once per pose. @type {{ pose: Pose, depths: Float64Array } | null} */
    let before = null;
    const depthsBefore = () => {
      if (before?.pose !== history.pose) before = { pose: history.pose, depths: depths(measuring, history.pose) };
      return before.depths;
    };

    let queued = false;
    /** Draws the view at the next frame (once, however many changes before it). */
    function drawSoon() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const pose = current();
        // A move being made shows the parts it pushes into each other.
        const clash = draft && mode === "pose" ? clashingParts(measuring, history.pose, draft, depthsBefore()) : null;
        view.show(pose, { laying, selected: mode === "pose" ? selected : null, rope: mode === "rope" ? chosen?.index ?? -1 : -1, clash });
        view.draw();
        marks.draw([...(marksShow(pose.marks, pose.camera) ? /** @type {import("./pose-marks.js").Marks} */ (pose.marks).strokes : []),
          ...(markLine ? [markLine] : [])]);
      });
    }

    /** The view and every control, after any change. */
    function drawAll() {
      // An undo can take the rope chosen away.
      if (chosen && chosen.index >= current().ropes.length) chosen = null;
      drawSoon();
      undoButton.disabled = history.past.length === 0 && !laying?.p.length && !cinching;
      redoButton.disabled = history.future.length === 0;
      drawPosePanel();
      drawRopePanel();
      fadePanels();
    }

    const resized = new ResizeObserver(() => {
      const { width: w, height: hgt } = frame.getBoundingClientRect();
      if (w > 0 && hgt > 0) {
        view.setSize(w, hgt);
        drawSoon();
      }
      fadePanels();
    });

    // --- changes ---------------------------------------------------------------

    /** @param {Pose} pose a change, to undo back from */
    function commit(pose) {
      draft = null;
      history = change(history, pose);
      say("");
      drawAll();
    }

    /** @param {number[]} camera */
    function lookAt(camera) {
      history = look(history, setCamera(history.pose, camera));
      if (draft) draft = { ...draft, camera: history.pose.camera };
      drawSoon();
    }

    function doUndo() {
      // Tying a cinch: Undo stops it.
      if (cinching) {
        cinching = null;
        drawAll();
        return;
      }
      // Laying a rope: the last point goes first.
      if (laying?.p.length) {
        laying = { ...laying, p: laying.p.slice(0, -1) };
        drawAll();
        return;
      }
      history = undo(history);
      chosen = null;
      cinching = null;
      drawAll();
    }

    function doRedo() {
      history = redo(history);
      chosen = null;
      cinching = null;
      drawAll();
    }

    /**
     * A row with a slider: dragging it shows the pose at once, and letting
     * go makes it one change. The number beside it is a box to type a value
     * into (Enter or leaving the box makes it one change), kept within the
     * slider's range; anything but a number puts the old value back. ▲
     * and ▼ beside the box step it by one, each tap a change.
     * settle, if given, has the last say on a change once it's made (let
     * go, typed or stepped): a limb's clashes settled.
     * @param {{ id: string, label: string, min: number, max: number, value: number,
     *   apply: (pose: Pose, value: number) => Pose, settle?: (before: Pose, after: Pose) => Pose }} row
     */
    function slider({ id, label, min, max, value, apply, settle = (_before, after) => after }) {
      /** @param {number} v */
      const change = (v) => commit(settle(history.pose, apply(history.pose, v)));
      // type="number" (not an inputmode) so an iPhone's keyboard has a minus sign.
      const typed = privateField(h("input", {
        type: "number", id: `${id}-typed`, className: "pose-value", min: String(min), max: String(max), step: "1",
        value: String(value), "aria-label": `${label}, typed`,
      }));
      const input = privateField(h("input", { type: "range", id, min: String(min), max: String(max), step: "1", value: String(value) }));
      input.addEventListener("input", () => {
        draft = apply(history.pose, Number(input.value));
        typed.value = input.value;
        drawSoon();
      });
      input.addEventListener("change", () => change(Number(input.value)));
      typed.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          typed.blur();
        }
      });
      typed.addEventListener("change", () => {
        const number = typedNumber(typed.value, [min, max]);
        if (number === null || number === Number(input.value)) {
          typed.value = input.value;
          return;
        }
        change(number);
      });
      /** @param {1 | -1} by */
      const step = (by) => {
        const number = clamp(Number(input.value) + by, [min, max]);
        if (number !== Number(input.value)) change(number);
      };
      const steps = h("div", { className: "pose-steps" },
        h("button", { type: "button", id: `${id}-up`, className: "pose-step", "aria-label": `${label}: up one`, title: "Up one", onclick: () => step(1) }, "▲"),
        h("button", { type: "button", id: `${id}-down`, className: "pose-step", "aria-label": `${label}: down one`, title: "Down one", onclick: () => step(-1) }, "▼"));
      return h("div", { className: "pose-slider" }, h("label", { htmlFor: id }, label), input, steps, typed);
    }

    function drawShapePanel() {
      const pose = current();
      // Nothing to save when it's already the default.
      saveShapeButton.disabled = sameShape(pose.shape, defaultShape ?? DEFAULT_SHAPE);
      resetShapeButton.disabled = sameShape(pose.shape, DEFAULT_SHAPE);
      if (draft) return;
      shapeSliders.replaceChildren(...SHAPE_SLIDERS.map(({ label }, i) => slider({
        id: `pose-shape-${i}`, label, min: SHAPE_RANGES[i][0], max: SHAPE_RANGES[i][1], value: pose.shape[i],
        apply: (p, v) => withShape(measuring, p, /** @type {import("./figure-body.js").Shape} */ (p.shape.map((n, k) => (k === i ? v : n)))),
      })));
    }

    function drawPosePanel() {
      const pose = current();
      drawShapePanel();
      // A slider being dragged keeps its place (redrawing it would drop the drag).
      if (draft) return;
      if (!selected) {
        partName.textContent = "Tap a body part to pose it";
        sliders.replaceChildren();
        resetPart.hidden = true;
        return;
      }
      partName.textContent = /** @type {Record<string, string>} */ (PART_LABELS)[selected];
      resetPart.hidden = false;
      const joint = /** @type {import("./figure-rig.js").Joint} */ (jointNamed(selected));
      const own = joint.moves.map((m, i) => slider({
        id: `pose-${joint.name}-${i}`, label: m.label, min: m.min, max: m.max, value: pose.joints[joint.name][i],
        // A see-saw rope's other end moves to keep it the same length; let
        // go, any clash is settled (pose-contact.js).
        apply: (p, v) => keepSeesaws(p, setJoint(p, joint.name, i, v), [joint.name]),
        settle: (before, after) => settleClashes(measuring, before, after, [joint.name]),
      }));
      if (joint.name !== "head") {
        sliders.replaceChildren(...own);
        return;
      }
      // Under the head's own sliders, the whole body's: tipping, turning
      // and rolling it, its height, and moving it front to back and across,
      // with a Reset of their own.
      sliders.replaceChildren(...own,
        h("div", { className: "pose-part-row pose-whole-row" },
          h("h4", { className: "pose-part", id: "pose-whole" }, "Whole body"),
          h("button", { type: "button", className: "tool", id: "pose-reset-whole", onclick: resetWholeBody }, "Reset")),
        ...BODY_MOVES.map((m, i) => slider({
          id: `pose-body-${i}`, label: m.label, min: m.min, max: m.max, value: pose.body[i],
          apply: (p, v) => setBody(p, i, v),
        })),
        slider({ id: "pose-lift", label: "Height (cm)", min: LIFT_RANGE[0], max: LIFT_RANGE[1], value: pose.lift, apply: setLift }),
        ...[1, 0].map((i) => slider({
          id: `pose-shift-${i}`, label: SHIFT_SLIDERS[i], min: SHIFT_RANGE[i][0], max: SHIFT_RANGE[i][1], value: pose.shift[i],
          apply: (p, v) => setShift(p, i, v),
        })));
    }

    function resetSelected() {
      if (!selected) return;
      const joint = /** @type {import("./figure-rig.js").Joint} */ (jointNamed(selected));
      commit({ ...history.pose, joints: { ...history.pose.joints, [joint.name]: startJoints()[joint.name] } });
    }

    /** Stands the whole body up, facing ahead, its feet on the floor for its body's height. */
    function resetWholeBody() {
      commit({ ...history.pose, body: [0, 0, 0], lift: Math.round(standingLift(history.pose.shape)), shift: [0, 0] });
    }

    function drawRopePanel() {
      const pose = current();
      const kind = hardpointOf(pose);
      for (const [i, button] of hardpointButtons.entries()) {
        const on = HARDPOINTS[i] === kind;
        button.setAttribute("aria-pressed", String(on));
        button.title = `${on ? "Remove" : "Add"} ${HARDPOINTS[i]}`;
      }
      finishButton.disabled = !laying?.p.length;
      const rope = chosen ? pose.ropes[chosen.index] : null;
      ropeHint.textContent = erasing ? "Tap a rope to take it out."
        : cinching ? "Now tap another upline, a rope or the body to tie the cinch to."
          : laying?.p.length ? `Rope: ${laying.p.length} ${laying.p.length === 1 ? "point" : "points"}. Keep tapping, then Finish rope.`
            : rope && isCinch(rope) ? "Shorten the cinch to pull the upline aside. Tap the view anywhere else to let it go."
              : rope ? "Rope chosen. Cinch from here ties a cinch from where you tapped it. Tap anywhere else to let it go."
                : kind === "hashira" ? "Tap the body to lay a rope, point by point. Tap the hashira to tie to it. Tap a rope to choose it."
                  : kind ? `Tap the body to lay a rope, point by point. Tap the ${kind} for an upline. Tap a rope to choose it.`
                    : "Tap the body to lay a rope, point by point. Add a ring, bamboo or hashira to tie to.";
      if (draft) return;
      drawRopeOptions(pose);
      // Moving along the bamboo ends when the rope's let go (or gone).
      if (sliding && (chosen?.index !== sliding.index || pose.ropes[sliding.index]?.p[sliding.point]?.[0] !== "bamboo" || !pose.bamboo)) {
        sliding = null;
      }
      if (sliding && pose.bamboo) {
        const { index, point } = sliding;
        const half = Math.floor(pose.bamboo[4] / 2);
        hardpointSliders.replaceChildren(
          slider({
            id: "pose-along-bamboo", label: "Along the bamboo (cm)", min: -half, max: half,
            value: Math.round(pose.ropes[index].p[point][1] / 10), apply: (p, v) => moveAlongBamboo(p, index, point, v),
          }),
          h("button", { type: "button", className: "tool pose-along-done", id: "pose-along-done", onclick: () => {
            sliding = null;
            drawAll();
          } }, "Done"));
        return;
      }
      if (!kind) {
        hardpointSliders.replaceChildren();
        return;
      }
      const ranges = HARDPOINT_RANGES[kind];
      // A bamboo's hangers stay on their own side of its middle.
      const top = (/** @type {number} */ i) => (kind === "bamboo" && i === 5 ? maxInset(/** @type {number[]} */ (pose.bamboo)[4]) : ranges[i][1]);
      hardpointSliders.replaceChildren(...HARDPOINT_SLIDERS[kind].map((label, i) => slider({
        id: `pose-${kind}-${i}`, label, min: ranges[i][0], max: top(i),
        value: /** @type {number[]} */ (pose[kind])[i],
        apply: (p, v) => {
          const place = [.../** @type {number[]} */ (p[kind])];
          place[i] = v;
          return moveHardpoint(p, place);
        },
      })));
    }

    /**
     * The chosen rope's options: whether it's a see-saw, Cinch from here;
     * or a cinch's length, and whether it moves the body.
     * @param {Pose} pose
     */
    function drawRopeOptions(pose) {
      const rope = chosen ? pose.ropes[chosen.index] : null;
      if (!chosen || !rope) {
        ropeOptions.replaceChildren();
        return;
      }
      const index = chosen.index;
      if (isCinch(rope)) {
        posed(measuring, pose);
        const gap = Math.max(1, Math.round(cinchEnds(measuring, pose, index).gap));
        const still = !!rope.still;
        ropeOptions.replaceChildren(
          h("div", { className: "pose-sliders" }, slider({
            id: "pose-cinch-length", label: "Cinch length (cm)", min: 0, max: gap, value: Math.min(/** @type {number} */ (rope.l), gap),
            apply: (p, v) => (still ? setCinchLength(p, index, v) : cinchBody(p, index, v)),
          })),
          checkbox("pose-cinch-body", "Move the body", !still, (on) => commit({
            ...history.pose, ropes: history.pose.ropes.map((r, i) => {
              if (i !== index) return r;
              const { still: _, ...moving } = r;
              return on ? moving : { ...moving, still: /** @type {true} */ (true) };
            }),
          })));
        return;
      }
      const top = rope.p.find((p) => p[0] === "ring" || p[0] === "bamboo")?.[0] ?? "hardpoint";
      const cinched = cinchOn(pose, index) >= 0;
      const onBamboo = bambooEnd(rope, chosen.segment);
      ropeOptions.replaceChildren(...[
        canSeesaw(rope) ? checkbox("pose-seesaw", `See-saw: runs over the ${top}`, !!rope.s, (on) => commit(setSeesaw(history.pose, index, on))) : null,
        h("div", { className: "tool-group" },
          h("button", {
            type: "button", className: "tool", id: "pose-cinch-start", disabled: cinched,
            title: cinched ? "This rope has a cinch already" : "Tie a cinch from where you tapped the rope", onclick: startCinch,
          }, "Cinch from here"),
          onBamboo >= 0 ? h("button", {
            type: "button", className: "tool", id: "pose-along-start", "aria-pressed": String(sliding?.index === index),
            title: "Slide where it's tied along the bamboo", onclick: () => {
              sliding = sliding?.index === index ? null : { index, point: onBamboo };
              drawAll();
            },
          }, "Move along bamboo") : null),
        cinched ? h("p", { className: "hint" }, "This rope has a cinch already: erase it to tie another.")
          : !isUpline(rope) ? h("p", { className: "hint" }, "Its other end goes on an upline.") : null,
      ].filter((el) => el !== null));
    }

    /**
     * Which of a rope's points is the bamboo end of the stretch tapped (or
     * its first on the bamboo, if that stretch isn't one).
     * @param {Rope} rope
     * @param {number} segment
     * @returns {number} the point's index, or -1 if it isn't on the bamboo
     */
    function bambooEnd(rope, segment) {
      const ends = [segment, segment + 1].filter((i) => rope.p[i]?.[0] === "bamboo");
      return ends.length ? ends[0] : rope.p.findIndex((p) => p[0] === "bamboo");
    }

    /**
     * A checkbox with its label, as one change when ticked or unticked.
     * @param {string} id @param {string} label @param {boolean} checked @param {(on: boolean) => void} onchange
     */
    function checkbox(id, label, checked, onchange) {
      const box = h("input", { type: "checkbox", id, checked });
      box.addEventListener("change", () => onchange(box.checked));
      return h("label", { className: "pose-check", htmlFor: id }, box, label);
    }

    /** "Cinch from here": the cinch's first end, where the rope chosen was tapped. */
    function startCinch() {
      if (!chosen) return;
      cinching = ropeSpot(chosen.index, chosen.segment, chosen.along);
      chosen = null;
      say("");
      drawAll();
    }

    // --- modes and tools -------------------------------------------------------

    /** @param {"pose" | "rope" | "draw"} next */
    function setMode(next) {
      if (next !== "rope") {
        endRope();
        chosen = null;
        cinching = null;
      }
      mode = next;
      poseTab.setAttribute("aria-pressed", String(mode === "pose"));
      ropeTab.setAttribute("aria-pressed", String(mode === "rope"));
      drawTab.setAttribute("aria-pressed", String(mode === "draw"));
      posePanel.hidden = mode !== "pose";
      ropePanel.hidden = mode !== "rope";
      drawPanel.hidden = mode !== "draw";
      // In pencil mode the marks take the view's taps, so fingers only draw.
      marks.svg.classList.toggle("drawing", mode === "draw");
      if (mode === "rope") setErasing(false);
      if (mode === "draw") setErasingMarks(false);
      drawAll();
    }

    /** @param {boolean} on */
    function setErasingMarks(on) {
      erasingMarks = on;
      marks.svg.classList.toggle("erasing", on);
      for (const [i, button] of markColorButtons.entries()) button.setAttribute("aria-pressed", String(!on && COLORS[i] === color));
      for (const [i, button] of markWidthButtons.entries()) button.setAttribute("aria-pressed", String(!on && WIDTHS[i] === width));
      markEraserButton.setAttribute("aria-pressed", String(on));
      for (const button of markWidthButtons) button.className = `tool width-tool ink-${color}`;
    }

    /** @param {Color} c */
    function pickColor(c) {
      color = lastColor = c;
      if (laying) laying = { ...laying, c };
      setErasing(false);
      setErasingMarks(false);
      drawSoon();
    }

    /** @param {Width} w */
    function pickWidth(w) {
      width = lastWidth = w;
      if (laying) laying = { ...laying, w };
      setErasing(false);
      setErasingMarks(false);
      drawSoon();
    }

    /** @param {boolean} on */
    function setErasing(on) {
      if (on) {
        endRope();
        chosen = null;
        cinching = null;
      }
      erasing = on;
      for (const [i, button] of colorButtons.entries()) button.setAttribute("aria-pressed", String(!on && COLORS[i] === color));
      for (const [i, button] of widthButtons.entries()) button.setAttribute("aria-pressed", String(!on && WIDTHS[i] === width));
      eraserButton.setAttribute("aria-pressed", String(on));
      for (const button of widthButtons) button.className = `tool width-tool ink-${color}`;
      drawAll();
    }

    /** Ends the rope being laid: it's a change if it has two points or more. */
    function endRope() {
      if (!laying) return;
      const rope = laying;
      laying = null;
      if (rope.p.length >= 2) commit(finishRope(history.pose, rope));
      else if (rope.p.length === 1) say("A rope needs two points or more, so that one was left out.");
    }

    /**
     * Adds this hardpoint in place of any other, or takes it away if it's
     * there, asking first if rope points on the old one would go.
     * @param {import("./pose-format.js").Hardpoint} kind
     */
    async function toggleHardpoint(kind) {
      endRope();
      chosen = null;
      cinching = null;
      const now = hardpointOf(history.pose);
      const next = now === kind ? null : kind;
      const lost = hardpointPointsLost(history.pose, next);
      if (lost > 0) {
        const choice = await choose({
          title: `Take the ropes off the ${now}?`,
          message: `${lost} rope ${lost === 1 ? "point is" : "points are"} on the ${now}. ` +
            `${next ? `They can't move to a ${next}, so they'll` : "They'll"} be taken out (Undo brings them back).`,
          choices: [{ label: next ? `Add ${next}` : `Remove ${now}`, value: "go" }],
        });
        if (choice !== "go") return;
      }
      // A new hashira goes just behind the body, wherever it's standing.
      const place = next === "hashira" ? behindBody(measuring, history.pose) ?? undefined : undefined;
      commit(setHardpoint(history.pose, next, place));
    }

    /** A picture of the pose as it is now, with the pencil marks showing on it. */
    async function picture() {
      const pose = history.pose;
      const blob = await poseImage(pose, PICTURE);
      return marksShow(pose.marks, pose.camera) ? withMarks(blob, /** @type {import("./pose-marks.js").Marks} */ (pose.marks).strokes, PICTURE) : blob;
    }

    let adding = false;
    /** "Add to visuals": a picture of the pose as it is now. */
    async function addPicture() {
      if (!addToVisuals || adding) return;
      adding = true;
      /** @type {HTMLButtonElement} */ (addVisualButton).disabled = true;
      try {
        say("Adding a picture to the visuals…");
        await addToVisuals(await picture());
        say("Added to visuals, as a photo.");
      } catch (err) {
        say(err instanceof Error ? err.message : String(err), true);
      } finally {
        adding = false;
        /** @type {HTMLButtonElement} */ (addVisualButton).disabled = false;
      }
    }

    /** Saves a picture of the pose as it is now to the device, as a PNG. */
    async function download() {
      try {
        saveFile(`notonawa-pose-${today()}.png`, await picture(), "image/png");
      } catch (err) {
        say(err instanceof Error ? err.message : String(err), true);
      }
    }

    // --- taps and drags on the view ---------------------------------------------

    /** @param {number} x @param {number} y CSS px from the canvas's corner */
    function tap(x, y) {
      if (mode === "pose") {
        const hit = view.pick(x, y);
        if (hit?.kind === "body") {
          selected = hit.part;
          drawAll();
        }
        return;
      }
      if (mode !== "rope") return;
      if (erasing) {
        const hit = view.pick(x, y, { ropes: true });
        if (hit?.kind === "rope") commit(removeRope(history.pose, hit.index));
        return;
      }
      if (cinching) {
        tieCinch(cinching, view.pick(x, y, { ropes: true }));
        return;
      }
      // Not laying a rope: tapping one chooses it (and tapping it again,
      // or anywhere else, lets it go).
      if (!laying?.p.length) {
        const onRope = view.pick(x, y, { ropes: true });
        if (onRope?.kind === "rope") {
          posed(measuring, history.pose);
          chosen = chosen?.index === onRope.index ? null : { index: onRope.index, ...spotOn(measuring, history.pose, onRope.index, onRope.point) };
          say("");
          drawAll();
          return;
        }
        if (chosen) {
          chosen = null;
          drawAll();
          return;
        }
      }
      const hit = view.pick(x, y);
      if (!hit || hit.kind === "rope") return;
      const problem = cantAdd(history.pose, laying);
      if (problem) {
        say(problem, true);
        return;
      }
      const point = hit.kind === "ring" ? RING_POINT
        : hit.kind === "bamboo" ? bambooPoint(hit.along, /** @type {number[]} */ (history.pose.bamboo)[4])
          : hit.kind === "hashira" ? hashiraPoint(hit.mm) : bonePoint(hit.bone, hit.mm);
      laying = addPoint(laying ?? { c: color, w: width, p: [] }, point);
      say("");
      drawAll();
    }

    /**
     * Ties the cinch being started to what was tapped (another rope, or
     * the body), as long as the gap between its ends: taut, to be shortened.
     * @param {RopePoint} from its first end
     * @param {import("./pose-scene.js").Hit | null} hit
     */
    function tieCinch(from, hit) {
      /** @type {RopePoint | null} */
      let to = null;
      if (hit?.kind === "rope") {
        posed(measuring, history.pose);
        const { segment, along } = spotOn(measuring, history.pose, hit.index, hit.point);
        to = ropeSpot(hit.index, segment, along);
      } else if (hit?.kind === "body") {
        to = bonePoint(hit.bone, hit.mm);
      }
      if (!to) {
        say("Tap another upline, a rope or the body to tie the cinch to.", true);
        return;
      }
      const problem = cantCinch(history.pose, from, to);
      if (problem) {
        say(problem, true);
        return;
      }
      cinching = null;
      const taut = addCinch(history.pose, { c: color, w: width }, from, to, 0);
      const index = taut.ropes.length - 1;
      posed(measuring, taut);
      commit(setCinchLength(taut, index, Math.round(cinchEnds(measuring, taut, index).gap)));
      chosen = { index, segment: 0, along: 0.5 };
      say("Cinch tied. Shorten it to pull the upline aside.");
      drawAll();
    }

    /** The pointers down on the view, where each started and is now. @type {Map<number, { x0: number, y0: number, x: number, y: number }>} */
    const pointers = new Map();
    let dragged = false;
    /**
     * A limb being dragged (Pose mode, one finger that started on an arm or
     * a leg): the part held, the point held on it, and the flat surface
     * facing the camera it moves on.
     * @type {{ bone: string, cm: [number, number, number], through: import("./vendor/three.js").Vector3,
     *   normal: import("./vendor/three.js").Vector3 } | null}
     */
    let limb = null;
    /** The dragged limb's pose, before any see-saw follows it. @type {Pose | null} */
    let limbPose = null;
    /** The two-finger gesture's last spread and middle. @type {{ spread: number, x: number, y: number } | null} */
    let pinch = null;

    /**
     * The limb under a finger put down, to drag (and it's selected, so its
     * sliders show), or null for anything else, which turns the view.
     * @param {number} x @param {number} y CSS px from the canvas's corner
     */
    function grab(x, y) {
      const hit = view.pick(x, y);
      if (hit?.kind !== "body" || !canDrag(hit.bone)) return null;
      const cm = /** @type {[number, number, number]} */ (hit.mm.map((n) => n / 10));
      return { bone: hit.bone, cm, through: hit.point, normal: view.ray(x, y).direction };
    }

    /** @param {PointerEvent} event */
    const local = (event) => {
      const box = view.canvas.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    const twoFingers = () => {
      const [a, b] = [...pointers.values()];
      return { spread: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    view.canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      view.canvas.setPointerCapture(event.pointerId);
      const { x, y } = local(event);
      pointers.set(event.pointerId, { x0: x, y0: y, x, y });
      if (pointers.size === 1) {
        dragged = false;
        limb = mode === "pose" ? grab(x, y) : null;
      }
      if (pointers.size === 2) {
        // A second finger turns a limb's drag into a pinch, putting it back.
        if (limb) {
          limb = null;
          limbPose = null;
          draft = null;
          drawAll();
        }
        dragged = true;
        pinch = twoFingers();
      }
    });
    view.canvas.addEventListener("pointermove", (event) => {
      const p = pointers.get(event.pointerId);
      if (!p) return;
      const { x, y } = local(event);
      const dx = x - p.x, dy = y - p.y;
      p.x = x;
      p.y = y;
      const [yaw, pitch, distance, height, tx, tz] = current().camera;
      if (pointers.size >= 2 && pinch) {
        // Pinching zooms; the fingers' middle moving drags the view along
        // with it, as far in the room as on the screen.
        const now = twoFingers();
        const zoom = pinch.spread / Math.max(now.spread, 1);
        const cm = distance * PAN_PER_PX / Math.max(view.canvas.getBoundingClientRect().height, 1);
        const panned = panCamera(setCamera(current(), [yaw, pitch, distance * zoom, height, tx, tz]),
          -(now.x - pinch.x) * cm, (now.y - pinch.y) * cm);
        lookAt(panned.camera);
        pinch = now;
        return;
      }
      if (!dragged && Math.hypot(x - p.x0, y - p.y0) < DRAG_START) return;
      dragged = true;
      if (limb) {
        // The part dragged is selected, so its sliders show the angles after.
        selected = limb.bone;
        const target = onPlane(view.ray(x, y), limb.through, limb.normal);
        if (target) {
          limbPose = dragTo(limbPose ?? history.pose, limb.bone, limb.cm, target);
          draft = keepSeesaws(history.pose, limbPose, DRAG_CHAINS[limb.bone].map(([name]) => name));
          drawSoon();
        }
        return;
      }
      lookAt([yaw - dx * 0.45, pitch + dy * 0.35, distance, height, tx, tz]);
    });
    /** @param {PointerEvent} event */
    const lift = (event) => {
      const p = pointers.get(event.pointerId);
      if (!p) return;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (limb) {
        const held = limb.bone;
        limb = null;
        limbPose = null;
        // A limb dragged is one change, any clash settled (pose-contact.js);
        // let go of with a cancel, it's put back.
        if (draft && event.type === "pointerup") {
          commit(settleClashes(measuring, history.pose, draft, DRAG_CHAINS[held].map(([name]) => name)));
        } else if (draft) {
          draft = null;
          drawAll();
        }
      }
      if (event.type === "pointerup" && !dragged && pointers.size === 0) tap(p.x, p.y);
    };
    view.canvas.addEventListener("pointerup", lift);
    view.canvas.addEventListener("pointercancel", lift);
    view.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const [yaw, pitch, distance, height, tx, tz] = current().camera;
      lookAt([yaw, pitch, distance * (1 + Math.sign(event.deltaY) * 0.1), height, tx, tz]);
    }, { passive: false });
    // No scrolling, zooming the page or the iPhone's hold menu on the view.
    view.canvas.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
    view.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    // --- the pencil ---------------------------------------------------------------

    /** The mark being drawn. @type {Stroke | null} */
    let markLine = null;
    /** The marks while the eraser is dragged, one change when it lifts. @type {Stroke[] | null} */
    let erasedMarks = null;
    let markPointer = -1;
    /** @param {PointerEvent} event @returns {[number, number]} */
    const markPoint = (event) => {
      const box = marks.svg.getBoundingClientRect();
      return toViewUnits(event.clientX - box.left, event.clientY - box.top, box);
    };
    /** The marks showing now. */
    const shownMarks = () => (marksShow(history.pose.marks, history.pose.camera)
      ? /** @type {import("./pose-marks.js").Marks} */ (history.pose.marks).strokes : []);
    /** @param {[number, number]} point */
    const eraseMark = (point) => {
      if (!erasedMarks) return;
      const i = markAt(erasedMarks, point);
      if (i < 0) return;
      erasedMarks = erasedMarks.filter((_, j) => j !== i);
      marks.draw(erasedMarks);
    };
    marks.svg.addEventListener("pointerdown", (event) => {
      if (mode !== "draw" || markPointer !== -1 || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      markPointer = event.pointerId;
      marks.svg.setPointerCapture(event.pointerId);
      if (erasingMarks) {
        erasedMarks = shownMarks();
        eraseMark(markPoint(event));
        return;
      }
      markLine = { c: color, w: width, p: markPoint(event) };
      drawSoon();
    });
    marks.svg.addEventListener("pointermove", (event) => {
      if (event.pointerId !== markPointer) return;
      const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
      for (const e of events.length ? events : [event]) {
        const [x, y] = markPoint(e);
        if (erasedMarks) eraseMark([x, y]);
        else if (markLine) {
          const p = markLine.p;
          if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) >= MARK_STEP) p.push(x, y);
        }
      }
      if (markLine) drawSoon();
    });
    /** @param {PointerEvent} event */
    const endMark = (event) => {
      if (event.pointerId !== markPointer) return;
      markPointer = -1;
      if (erasedMarks) {
        const left = erasedMarks;
        erasedMarks = null;
        if (left.length !== shownMarks().length) {
          commit({ ...history.pose, marks: { camera: [...history.pose.camera], strokes: left } });
        } else drawSoon();
        return;
      }
      const line = markLine;
      markLine = null;
      if (line) commit({ ...history.pose, marks: addMark(history.pose.marks, history.pose.camera, line) });
    };
    marks.svg.addEventListener("pointerup", endMark);
    marks.svg.addEventListener("pointercancel", endMark);
    marks.svg.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
    marks.svg.addEventListener("contextmenu", (event) => event.preventDefault());

    // --- leaving -----------------------------------------------------------------

    async function cancel() {
      if (history.past.length > 0 || laying?.p.length) {
        const choice = await choose({
          title: "Discard your changes?",
          message: "What you've changed since opening this won't be saved.",
          choices: [{ label: "Discard changes", value: "discard", style: "solid-danger" }],
        });
        if (choice !== "discard") return;
      }
      dialog.close();
    }

    function save() {
      endRope();
      result = forSaving(history.pose);
      dialog.close();
    }

    document.body.append(dialog);
    dialog.showModal();
    // The screen stays on while the poser is open.
    const letSleep = keepAwake();
    resized.observe(frame);
    setMode("pose");
    setErasing(false);
  });
}
