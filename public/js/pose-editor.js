// The poser: a dialog filling the screen, over the form it was opened from
// (a separate view would close that form), as the drawing pad is. It shows
// the figure in 3D (pose-scene.js) with two ways of working:
//
//   Pose  tap a body part, then move it with the sliders below; the hips
//         move the whole body (tipping it over, turning it, lifting it,
//         moving it across and front to back), and the head has the
//         lifting and moving too.
//         A starting position for the body, and one for the arms (each
//         keeping the other), or a quick turn of the whole body, from the
//         menus.
//   Rope  tap the body, point after point, to lay a rope; tap the
//         hardpoint (a ring or bamboo for uplines, or a hashira to tie
//         to). "Finish rope" ends one. The eraser takes out the rope
//         tapped. One hardpoint at a time can be added, moved and taken
//         away.
//
// One finger dragging turns the view round the figure; two pinch to zoom
// and drag to pan. Sliders work as a phone's touch would want, with a
// finger, rather than dragging handles in 3D. "Add to visuals" puts a
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
  PART_LABELS, BODY_PRESETS, ARMS_PRESETS, ORIENTATIONS, BODY_MOVES, LIFT_RANGE, jointNamed, withBodyPreset, withArmsPreset,
} from "./figure-rig.js";
import {
  COLORS, WIDTHS, HARDPOINTS, HARDPOINT_RANGES, SHIFT_RANGE, RING_POINT, newPose, readPose, setJoint, setBody, setLift, setShift,
  setCamera, panCamera,
  hardpointOf, setHardpoint, moveHardpoint, hardpointPointsLost, bambooPoint, hashiraPoint,
  bonePoint, addPoint, finishRope, removeRope, cantAdd, withPosture, startHistory, change, look, undo, redo,
} from "./pose-format.js";
import { poseView, poseImage } from "./pose-scene.js";
import { TOOL_ICONS } from "./tool-icons.js";
import { saveFile } from "./download.js";

/** @typedef {import("./pose-format.js").Pose} Pose */
/** @typedef {import("./pose-format.js").Rope} Rope */
/** @typedef {import("./drawing-format.js").Color} Color */
/** @typedef {import("./drawing-format.js").Width} Width */

const WIDTH_NAMES = /** @type {const} */ ({ 1: "Thin", 2: "Medium", 3: "Thick" });
/** Quick views: [yaw, pitch], keeping the distance and height. */
const VIEWS = /** @type {const} */ ([["Front", 0, 8], ["Left side", 90, 8], ["Back", 180, 8], ["Right side", -90, 8], ["Above", 25, 70]]);
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
  bamboo: ["Across (cm)", "Height (cm)", "Front to back (cm)", "Turn"],
  hashira: ["Across (cm)", "Front to back (cm)", "Turn"],
});

// The last rope color and width chosen, kept while the page is open.
/** @type {Color} */
let lastColor = "red";
/** @type {Width} */
let lastWidth = 2;

/**
 * Opens the poser on a pose (or a new one, standing).
 * @param {Pose | null} start
 * @param {{ addToVisuals?: (pose: Pose) => Promise<void> }} [options] addToVisuals:
 *   puts a picture of the pose into the item's visuals (the button's left out without it)
 * @returns {Promise<Pose | null>} the new pose, or null if cancelled
 */
export function editPose(start, { addToVisuals } = {}) {
  return new Promise((resolve) => {
    let history = startHistory(start ? readPose(start) : newPose());
    /** A slider being dragged: its pose, not yet a change (it is when let go). @type {Pose | null} */
    let draft = null;
    /** @type {"pose" | "rope"} */
    let mode = "pose";
    /** The part being posed. @type {string | null} */
    let selected = null;
    /** The rope being laid. @type {Rope | null} */
    let laying = null;
    let erasing = false;
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
    // The hint top left, the views top right, over the 3D view.
    const frame = h("div", { className: "pose-frame" }, view.canvas,
      h("p", { className: "pose-hint", "aria-hidden": "true" }, "Drag to turn · 2 fingers to pan · pinch to zoom"),
      viewMenu);

    // --- the Pose panel ----------------------------------------------------------

    const bodyMenu = h("select", { id: "pose-body-preset", "aria-label": "Body position", onchange: () => {
      const preset = BODY_PRESETS[Number(bodyMenu.value)];
      bodyMenu.value = "";
      if (preset) commit(withPosture(history.pose, withBodyPreset(history.pose, preset)));
    } }, h("option", { value: "" }, "Body…"), BODY_PRESETS.map((p, i) => h("option", { value: String(i) }, p.name)));
    const armsMenu = h("select", { id: "pose-arms-preset", "aria-label": "Arms position", onchange: () => {
      const preset = ARMS_PRESETS[Number(armsMenu.value)];
      armsMenu.value = "";
      if (preset) commit(withPosture(history.pose, withArmsPreset(history.pose, preset)));
    } }, h("option", { value: "" }, "Arms…"), ARMS_PRESETS.map((p, i) => h("option", { value: String(i) }, p.name)));
    const turnMenu = h("select", { id: "pose-orientation", "aria-label": "Turn the whole body", onchange: () => {
      const choice = ORIENTATIONS[Number(turnMenu.value)];
      turnMenu.value = "";
      if (choice) commit({ ...history.pose, body: [...choice.body] });
    } }, h("option", { value: "" }, "Turn body…"), ORIENTATIONS.map((o, i) => h("option", { value: String(i) }, o.name)));
    const partName = h("h3", { className: "pose-part", id: "pose-part" });
    const sliders = h("div", { className: "pose-sliders", id: "pose-sliders" });
    const resetPart = h("button", { type: "button", className: "tool", id: "pose-reset-part", onclick: resetSelected }, "Reset");
    // The part's name, with Reset at the end of the same row.
    const posePanel = h("div", { className: "pose-panel", id: "pose-panel-pose" },
      h("div", { className: "pose-menus" }, bodyMenu, armsMenu, turnMenu),
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
    const ropePanel = h("div", { className: "pose-panel", id: "pose-panel-rope", hidden: true },
      h("div", { className: "tool-group pose-rope-tools", role: "group", "aria-label": "Rope thickness" }, widthButtons, eraserButton, finishButton),
      h("div", { className: "tool-group", role: "group", "aria-label": "Rope color" }, colorButtons),
      ropeHint,
      h("div", { className: "tool-group", role: "group", "aria-labelledby": "pose-hardpoint-label" },
        h("span", { className: "pose-row-label", id: "pose-hardpoint-label" }, "Hardpoint:"), hardpointButtons),
      hardpointSliders);

    const dialog = h("dialog", { className: "pose-editor", "aria-labelledby": "pose-heading" },
      h("h2", { id: "pose-heading", className: "visually-hidden" }, start ? "Edit pose" : "New pose"),
      h("div", { className: "pose-tools" },
        h("div", { className: "tool-group", role: "group", "aria-label": "Mode" }, poseTab, ropeTab),
        h("div", { className: "tool-group" }, undoButton, redoButton, downloadButton),
        addVisualButton),
      frame,
      h("div", { className: "pose-panels" }, posePanel, ropePanel),
      message,
      h("div", { className: "drawing-actions" },
        h("button", { type: "button", id: "pose-cancel", onclick: cancel }, "Cancel"),
        h("button", { type: "button", className: "primary", id: "pose-save", onclick: save }, "Save pose")));

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancel();
    });
    dialog.addEventListener("close", () => {
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

    let queued = false;
    /** Draws the view at the next frame (once, however many changes before it). */
    function drawSoon() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        view.show(current(), { laying, selected: mode === "pose" ? selected : null });
        view.draw();
      });
    }

    /** The view and every control, after any change. */
    function drawAll() {
      drawSoon();
      undoButton.disabled = history.past.length === 0 && !laying?.p.length;
      redoButton.disabled = history.future.length === 0;
      drawPosePanel();
      drawRopePanel();
    }

    const resized = new ResizeObserver(() => {
      const { width: w, height: hgt } = frame.getBoundingClientRect();
      if (w > 0 && hgt > 0) {
        view.setSize(w, hgt);
        drawSoon();
      }
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
      // Laying a rope: the last point goes first.
      if (laying?.p.length) {
        laying = { ...laying, p: laying.p.slice(0, -1) };
        drawAll();
        return;
      }
      history = undo(history);
      drawAll();
    }

    function doRedo() {
      history = redo(history);
      drawAll();
    }

    /**
     * A row with a slider: dragging it shows the pose at once, and letting
     * go makes it one change.
     * @param {{ id: string, label: string, min: number, max: number, value: number, apply: (pose: Pose, value: number) => Pose }} row
     */
    function slider({ id, label, min, max, value, apply }) {
      const shown = h("output", { htmlFor: id, className: "pose-value" }, String(value));
      const input = privateField(h("input", { type: "range", id, min: String(min), max: String(max), step: "1", value: String(value) }));
      input.addEventListener("input", () => {
        draft = apply(history.pose, Number(input.value));
        shown.textContent = input.value;
        drawSoon();
      });
      input.addEventListener("change", () => commit(apply(history.pose, Number(input.value))));
      return h("div", { className: "pose-slider" }, h("label", { htmlFor: id }, label), input, shown);
    }

    function drawPosePanel() {
      const pose = current();
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
      // The hips and the head both move the whole figure: up and down,
      // front to back, and across.
      const wholeFigure = () => [
        slider({ id: "pose-lift", label: "Height (cm)", min: LIFT_RANGE[0], max: LIFT_RANGE[1], value: pose.lift, apply: setLift }),
        ...[1, 0].map((i) => slider({
          id: `pose-shift-${i}`, label: SHIFT_SLIDERS[i], min: SHIFT_RANGE[i][0], max: SHIFT_RANGE[i][1], value: pose.shift[i],
          apply: (p, v) => setShift(p, i, v),
        })),
      ];
      if (selected === "pelvis") {
        sliders.replaceChildren(
          ...BODY_MOVES.map((m, i) => slider({
            id: `pose-body-${i}`, label: m.label, min: m.min, max: m.max, value: pose.body[i],
            apply: (p, v) => setBody(p, i, v),
          })),
          ...wholeFigure());
        return;
      }
      const joint = /** @type {import("./figure-rig.js").Joint} */ (jointNamed(selected));
      sliders.replaceChildren(...joint.moves.map((m, i) => slider({
        id: `pose-${joint.name}-${i}`, label: m.label, min: m.min, max: m.max, value: pose.joints[joint.name][i],
        apply: (p, v) => setJoint(p, joint.name, i, v),
      })), ...(joint.name === "head" ? wholeFigure() : []));
    }

    function resetSelected() {
      if (!selected) return;
      if (selected === "pelvis") {
        commit({ ...history.pose, body: [0, 0, 0], lift: newPose().lift, shift: [0, 0] });
        return;
      }
      const joint = /** @type {import("./figure-rig.js").Joint} */ (jointNamed(selected));
      commit({ ...history.pose, joints: { ...history.pose.joints, [joint.name]: joint.moves.map(() => 0) } });
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
      ropeHint.textContent = erasing ? "Tap a rope to take it out."
        : laying?.p.length ? `Rope: ${laying.p.length} ${laying.p.length === 1 ? "point" : "points"}. Keep tapping, then Finish rope.`
          : kind === "hashira" ? "Tap the body to lay a rope, point by point. Tap the hashira to tie to it."
            : kind ? `Tap the body to lay a rope, point by point. Tap the ${kind} for an upline.`
              : "Tap the body to lay a rope, point by point. Add a ring, bamboo or hashira to tie to.";
      if (draft) return;
      if (!kind) {
        hardpointSliders.replaceChildren();
        return;
      }
      const ranges = HARDPOINT_RANGES[kind];
      hardpointSliders.replaceChildren(...HARDPOINT_SLIDERS[kind].map((label, i) => slider({
        id: `pose-${kind}-${i}`, label, min: ranges[i][0], max: ranges[i][1],
        value: /** @type {number[]} */ (pose[kind])[i],
        apply: (p, v) => {
          const place = [.../** @type {number[]} */ (p[kind])];
          place[i] = v;
          return moveHardpoint(p, place);
        },
      })));
    }

    // --- modes and tools -------------------------------------------------------

    /** @param {"pose" | "rope"} next */
    function setMode(next) {
      if (next !== "rope") endRope();
      mode = next;
      poseTab.setAttribute("aria-pressed", String(mode === "pose"));
      ropeTab.setAttribute("aria-pressed", String(mode === "rope"));
      posePanel.hidden = mode !== "pose";
      ropePanel.hidden = mode !== "rope";
      if (mode === "rope") setErasing(false);
      drawAll();
    }

    /** @param {Color} c */
    function pickColor(c) {
      color = lastColor = c;
      if (laying) laying = { ...laying, c };
      setErasing(false);
      drawSoon();
    }

    /** @param {Width} w */
    function pickWidth(w) {
      width = lastWidth = w;
      if (laying) laying = { ...laying, w };
      setErasing(false);
      drawSoon();
    }

    /** @param {boolean} on */
    function setErasing(on) {
      if (on) endRope();
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
      commit(setHardpoint(history.pose, next));
    }

    let adding = false;
    /** "Add to visuals": a picture of the pose as it is now. */
    async function addPicture() {
      if (!addToVisuals || adding) return;
      adding = true;
      /** @type {HTMLButtonElement} */ (addVisualButton).disabled = true;
      try {
        say("Adding a picture to the visuals…");
        await addToVisuals(history.pose);
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
        saveFile(`notonawa-pose-${today()}.png`, await poseImage(history.pose, PICTURE), "image/png");
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
          selected = hit.bone;
          drawAll();
        }
        return;
      }
      if (erasing) {
        const hit = view.pick(x, y, { ropes: true });
        if (hit?.kind === "rope") commit(removeRope(history.pose, hit.index));
        return;
      }
      const hit = view.pick(x, y);
      if (!hit || hit.kind === "rope") return;
      const problem = cantAdd(history.pose, laying);
      if (problem) {
        say(problem, true);
        return;
      }
      const point = hit.kind === "ring" ? RING_POINT : hit.kind === "bamboo" ? bambooPoint(hit.along)
        : hit.kind === "hashira" ? hashiraPoint(hit.mm) : bonePoint(hit.bone, hit.mm);
      laying = addPoint(laying ?? { c: color, w: width, p: [] }, point);
      say("");
      drawAll();
    }

    /** The pointers down on the view, where each started and is now. @type {Map<number, { x0: number, y0: number, x: number, y: number }>} */
    const pointers = new Map();
    let dragged = false;
    /** The two-finger gesture's last spread and middle. @type {{ spread: number, x: number, y: number } | null} */
    let pinch = null;

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
      if (pointers.size === 1) dragged = false;
      if (pointers.size === 2) {
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
      lookAt([yaw - dx * 0.45, pitch + dy * 0.35, distance, height, tx, tz]);
    });
    /** @param {PointerEvent} event */
    const lift = (event) => {
      const p = pointers.get(event.pointerId);
      if (!p) return;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
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
      result = history.pose;
      dialog.close();
    }

    document.body.append(dialog);
    dialog.showModal();
    resized.observe(frame);
    setMode("pose");
    setErasing(false);
  });
}
