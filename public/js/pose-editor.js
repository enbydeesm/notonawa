// The poser: a dialog filling the screen, over the form it was opened from
// (a separate view would close that form), as the drawing pad is. It shows
// the figure in 3D (pose-scene.js) with two ways of working:
//
//   Pose  tap a body part, then move it with the sliders below, or drag
//         an arm or a leg by any part of it (pose-ik.js: the joints above
//         the part held turn to follow the finger); the hips
//         move the whole body (tipping it over, turning it, lifting it,
//         moving it across and front to back), and the head has the
//         lifting and moving too; dragging the head lifts or lowers the
//         whole body, as its Height slider does. The feet follow gravity
//         (pose-gravity.js): flat on the floor, onto their balls as the
//         heels lift, en pointe once off it.
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
  clampJoint,
} from "./figure-rig.js";
import { canReach } from "./joint-limits.js";
import { pickPreset, pickTurn } from "./preset-picker.js";
import {
  PICK_COLORS as COLORS, WIDTHS, HARDPOINT_RANGES, SHIFT_RANGE, RING_POINT, newPose, readPose, setJoint, setBody, setLift, setShift,
  setCamera, panCamera, typedNumber, clamp, maxInset, hangs, onBody, layerOf, setLayer, setSeeThrough,
  hardpointOf, setHardpoint, moveHardpoint, hardpointPointsLost, bambooPoint, hashiraPoint,
  bonePoint, addPoint, movePoint, removePoint, MAX_ROPE_POINTS, ROPE_RADIUS, finishRope, removeRope, cantAdd, withPosture, startHistory, change, look, undo, redo,
  samePose, isCinch, isUpline, hasLength, pullsUplines, canSeesaw, setSeesaw, cantCinch, cantCinchAt, cantAddTo, addCinch, setCinchLength, setSlack, SLACK_RANGE, ropeSpot, forSaving, moveAlongBamboo,
} from "./pose-format.js";
import { poseView, poseImage } from "./pose-scene.js";
import { SHAPE_RANGES, SHAPE_SLIDERS, DEFAULT_SHAPE, standingLift, sameShape } from "./figure-body.js";
import { loadSettings, saveDefaultShape } from "./settings.js";
import { canDrag, dragTo, onPlane, dragJoints } from "./pose-ik.js";
import { makeSkeleton, posed, toBone, withShape, withBodyPresetOn, onDefaultBody, withHipsOn } from "./pose-skeleton.js";
import { keepAwake } from "./wake-lock.js";
import { depths, clashingParts, settleClashes, behindBody, contactAccepted, clashesLeft, fixClashes } from "./pose-contact.js";
import { cinchPoints, spotOn, segmentLength } from "./pose-cinch.js";
import { grounded } from "./pose-gravity.js";
import { cinchBody, keepSeesaws, ropeLength, setRopeLength } from "./pose-constraints.js";
import { uplineStretch, uplineLength, setUplineLength, seesawSides, seesawLengths, setSeesawStart, SEESAW_END } from "./pose-uplines.js";
import { hang, canHang } from "./pose-hang.js";
import { skinOf, wrapRound, MAX_WRAPS } from "./pose-surface.js";
import { toViewUnits, marksShow, addMark, markAt } from "./pose-marks.js";
import { marksLayer, withMarks } from "./pose-marks-ui.js";
import { besideLayer } from "./pose-beside-ui.js";
import { besidePoint, addBeside } from "./pose-points.js";
import { TOOL_ICONS } from "./tool-icons.js";
import { scenePanel } from "./pose-scene-panel.js";
import { chosenRopeView } from "./pose-rope-panel.js";
import { viewHint, ropeHint, hardpointLostNote, pointGoneNote } from "./pose-hints.js";
import { saveFile } from "./download.js";
/** The joints the Hips sliders turn: the pelvis, and the hips that keep the legs where they were. */
const HIPS_MOVE = Object.freeze(["hips", "l_hip", "r_hip", "spine"]);

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

// The last rope and pencil colors and width chosen, kept while the page is
// open: ropes start jute, the pencil red, so marks stand out from ropes.
/** @type {Color} */
let lastRopeColor = "jute";
/** @type {Color} */
let lastMarkColor = "red";
/** @type {Width} */
let lastWidth = 2;
// "Allow collisions", ticked until it's unticked, kept while the page is
// open: body parts can go into each other, clashes showing orange while
// the move is made. Unticked, clashes, shown red, are settled when let go
// (pose-contact.js). Either way, joints keep to their ranges and to the
// limits that depend on several movements (joint-limits.js): at first
// ticking it turned those off too, which allowed horrific poses.
let allowCollisions = true;

/**
 * Opens the poser on a pose (or a new one, standing, in the account's
 * default body if one's saved).
 * @param {Pose | null} start
 * @param {{
 *   addToVisuals?: (picture: Blob) => Promise<void>,
 *   standalone?: boolean,
 *   place?: (placing: { pose: Pose } | { picture: Blob }, busy: () => void) => Promise<{ text: string, saved: boolean } | null>,
 * }} [options] addToVisuals:
 *   puts a picture of the pose (a PNG) into the item's visuals (the button's left out without it);
 *   standalone: opened on its own (the nav's button), not from an item: Cancel is Close, and
 *   Save pose and Add to visuals ask place where to put the pose or its picture
 *   (standalone-poser.js; it calls busy once it's chosen, while it saves), staying open after
 * @returns {Promise<Pose | null>} the new pose, or null if cancelled (always null standalone)
 */
export async function editPose(start, { addToVisuals, standalone = false, place } = {}) {
  /** The body new poses start with (null: the in-between one). @type {Shape | null} */
  let defaultShape = (await loadSettings().catch(() => null))?.default_shape ?? null;
  const fresh = () => (defaultShape ? withShape(makeSkeleton(), newPose(), defaultShape) : newPose());
  return new Promise((resolve) => {
    let history = startHistory(start ? readPose(start) : fresh());
    /** A slider being dragged: its pose, not yet a change (it is when let go). @type {Pose | null} */
    let draft = null;
    /** The tab shown. @type {"pose" | "rope" | "scene"} */
    let mode = "pose";
    /** The pencil's on: fingers draw over the view, in any tab. */
    let drawing = false;
    /** The part being posed. @type {string | null} */
    let selected = null;
    /** The rope being laid. @type {Rope | null} */
    let laying = null;
    /**
     * What's being laid: a rope, a cinch (Add cinch: its points on ropes or
     * the body, tied when finished) or a rope added to another (Add rope:
     * its first point a spot on that one).
     * @type {"rope" | "cinch" | "added"}
     */
    let layingKind = "rope";
    /** How many points the rope being laid had before each tap, so Undo takes a whole wrap back. @type {number[]} */
    let layingTaps = [];
    /** Wrap: a tap on the body lays a turn round that part (pose-surface.js), this many turns. */
    let wrapping = false;
    let wrapTurns = 1;
    let erasing = false;
    /**
     * The rope chosen (tapped in Rope mode), where on it, and the point of
     * it chosen (its dot tapped: its layer, points beside it, Remove).
     * @type {{ index: number, segment: number, along: number, point?: number } | null}
     */
    let chosen = null;
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
    /**
     * The contact counted as fine (pose-contact.js): what the pose opened
     * with, lowered as parts are pulled apart; a preset, a reset or a new
     * body shape is fine as it comes. What goes past it with collisions
     * allowed is a clash left, which unticking offers to fix.
     */
    let accepted = contactAccepted(measuring, history.pose);
    /** The ropes' color. @type {Color} */
    let color = lastRopeColor;
    /** The pencil's. @type {Color} */
    let markColor = lastMarkColor;
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

    // --- the tabs and the view's own tools ---------------------------------------

    /**
     * @param {string} id @param {string} label @param {string} className
     * @param {() => void} onclick @param {...any} children
     */
    const toggle = (id, label, className, onclick, ...children) => h("button", {
      type: "button", id, className: `tool ${className}`.trim(), "aria-label": label, title: label, "aria-pressed": "false", onclick,
    }, ...children);
    // Pose, Rope and Scene across the top, as one switch.
    const poseTab = toggle("pose-mode-pose", "Pose the figure", "pose-tab", () => setMode("pose"), "Pose");
    const ropeTab = toggle("pose-mode-rope", "Lay ropes", "pose-tab", () => setMode("rope"), "Rope");
    const sceneTab = toggle("pose-mode-scene", "The hardpoint and the body's shape", "pose-tab", () => setMode("scene"), "Scene");
    /**
     * A button showing an icon, its name in aria-label and title.
     * @param {string} id @param {string} label @param {import("./tool-icons.js").ToolIcon} kind @param {() => void} onclick
     * @param {string} [className]
     */
    const iconButton = (id, label, kind, onclick, className = "tool icon-tool") => h("button", {
      type: "button", className, id, "aria-label": label, title: label, onclick,
    }, TOOL_ICONS[kind]());
    // Over the view, top left: undo, redo and the pencil (drawing over the
    // view, in any tab).
    const undoButton = iconButton("pose-undo", "Undo", "undo", doUndo, "tool icon-tool pose-float-button");
    const redoButton = iconButton("pose-redo", "Redo", "redo", doRedo, "tool icon-tool pose-float-button");
    const drawTab = toggle("pose-mode-draw", "Draw over the view", "icon-tool pose-float-button", () => setDrawing(!drawing), TOOL_ICONS.pencil());
    // At the foot, beside Save pose: getting the picture out.
    const downloadButton = iconButton("pose-download", "Download picture", "download", download, "tool icon-tool pose-foot-icon");
    // Opened on its own, Add to visuals asks which tie, plan or workshop
    // the picture's for ("Add pose to…").
    const addVisualButton = addToVisuals || (standalone && place)
      ? iconButton("pose-add-visual", "Add to visuals", "addVisual", addPicture, "tool icon-tool pose-foot-icon") : null;
    // Over the view, top right: the cube, opening the quick views.
    const viewList = h("div", { className: "pose-view-list", id: "pose-view-list", role: "menu", hidden: true },
      VIEWS.map(([name, yaw, pitch], i) => h("button", {
        type: "button", className: "pose-view-item", id: `pose-view-${i}`, role: "menuitem", onclick: () => {
          showViews(false);
          const [, , distance, height, x, z] = current().camera;
          lookAt([yaw, pitch, distance, height, x, z]);
        },
      }, name)));
    const viewMenu = h("button", {
      type: "button", className: "tool icon-tool pose-float-button pose-view-menu", id: "pose-view-choice", "aria-label": "View from",
      title: "View from: front, side, back or above", "aria-haspopup": "menu", "aria-expanded": "false", onclick: () => showViews(viewList.hidden === true),
    }, TOOL_ICONS.views(), h("span", { className: "pose-chevron", "aria-hidden": "true" }, "▾"));
    /** @param {boolean} open */
    function showViews(open) {
      viewList.hidden = !open;
      viewMenu.setAttribute("aria-expanded", String(open));
    }
    const marks = marksLayer();
    const beside = besideLayer();
    // "Allow collisions" bottom right, as muted as the hint (Pose only).
    const allowBox = h("input", { type: "checkbox", id: "pose-allow-collisions", checked: allowCollisions, onchange: () => setAllowed(allowBox.checked) });
    const allowLabel = h("label", { className: "pose-allow", htmlFor: "pose-allow-collisions" }, allowBox, "Allow collisions");
    // The view's hint, bottom left: what fingers do in the tab (pose-hints.js).
    const viewHintLine = h("p", { className: "pose-view-hint", id: "pose-view-hint", "aria-hidden": "true" });

    // --- the Pose panel ----------------------------------------------------------

    // The pickers for the body's and arms' presets, and where the body
    // faces (preset-picker.js).
    /** @type {(kind: "body" | "arms") => void} */
    // A body preset's height is for the default body, so the body's turned
    // into that to compare and save, and a preset put on it the same way
    // (pose-skeleton.js): Standing stands on the floor whatever the height.
    const openPresets = (kind) => pickPreset({
      kind, builtIn: kind === "body" ? BODY_PRESETS : ARMS_PRESETS,
      posture: (of) => (of === "body" ? onDefaultBody(measuring, history.pose) : history.pose),
      apply: (preset) => commit(kind === "body"
        ? withBodyPresetOn(measuring, history.pose, /** @type {BodyPreset} */ (preset))
        : withPosture(history.pose, withArmsPreset(history.pose, /** @type {ArmsPreset} */ (preset))), true),
    });
    /**
     * A picker's button: its icon, its name, and ▾ (it opens a list).
     * @param {string} id @param {string} label @param {import("./tool-icons.js").ToolIcon} icon @param {() => void} onclick
     */
    const pickerButton = (id, label, icon, onclick) => h("button", {
      type: "button", className: "tool pose-picker", id, "aria-haspopup": "dialog", onclick,
    }, TOOL_ICONS[icon](), h("span", { className: "pose-picker-name" }, label), h("span", { className: "pose-chevron", "aria-hidden": "true" }, "▾"));
    const bodyButton = pickerButton("pose-body-preset", "Body", "bodyPosition", () => openPresets("body"));
    const armsButton = pickerButton("pose-arms-preset", "Arms", "armsPosition", () => openPresets("arms"));
    // Where the body faces is a different kind of choice, so it stands apart.
    const turnButton = pickerButton("pose-orientation", "Turn", "facing", () => pickTurn({
      orientations: ORIENTATIONS, body: history.pose.body, apply: (body) => commit({ ...history.pose, body: /** @type {[number, number, number]} */ (body) }),
    }));
    turnButton.setAttribute("aria-label", "Turn body");
    const partName = h("h3", { className: "pose-part", id: "pose-part" });
    const sliders = h("div", { className: "pose-sliders", id: "pose-sliders" });
    const resetPart = h("button", { type: "button", className: "tool", id: "pose-reset-part", onclick: resetSelected }, "Reset");
    // The part's name, with Reset at the end of the same row.
    const posePanel = h("div", { className: "pose-panel", id: "pose-panel-pose" },
      h("div", { className: "pose-menus" },
        h("div", { className: "pose-menu-group pose-positions", role: "group", "aria-labelledby": "pose-positions-label" },
          h("span", { className: "pose-row-label", id: "pose-positions-label" }, "Positions"),
          h("div", { className: "pose-menu-buttons" }, bodyButton, armsButton)),
        h("span", { className: "pose-menu-divider", "aria-hidden": "true" }),
        h("div", { className: "pose-menu-group", role: "group", "aria-labelledby": "pose-facing-label" },
          h("span", { className: "pose-row-label", id: "pose-facing-label" }, "Facing"),
          h("div", { className: "pose-menu-buttons" }, turnButton))),
      h("div", { className: "pose-part-row" }, partName, resetPart), sliders);

    // --- the Scene panel -----------------------------------------------------------

    const scene = scenePanel({
      onHardpoint: (kind) => toggleHardpoint(kind),
      onSaveShape: saveShapeAsDefault,
      onLoadDefault: () => commit(withShape(measuring, history.pose, DEFAULT_SHAPE)),
      // Back to my model (the app's own if I haven't saved one).
      onResetShape: () => commit(withShape(measuring, history.pose, defaultShape ?? DEFAULT_SHAPE)),
    });

    /** Saves the body shown as the one new poses start with ("Save as my model"). */
    async function saveShapeAsDefault() {
      const shape = /** @type {Shape} */ ([...current().shape]);
      scene.saveShapeButton.disabled = true;
      try {
        await saveDefaultShape(shape);
        defaultShape = shape;
        say("Saved as your model. New poses will start with this body.");
      } catch (err) {
        say(`Couldn't save your model: ${err instanceof Error ? err.message : "try again"}`, true);
      }
      drawScenePanel();
    }

    // --- the Rope panel ----------------------------------------------------------

    /**
     * The thickness, an eraser (an icon) and the colors: the Rope tab's and
     * the pencil's are the same rows in the same place, so turning the
     * pencil on moves nothing; each has its own color (the width is
     * shared). The end of the thickness row holds the hardpoint's chip for
     * ropes, Done for the pencil; ropes have Dangle before it.
     * @param {string} prefix the buttons' ids, e.g. "pose" (pose-color-red) or "pose-mark"
     * @param {string} what "Rope" or "Line", for their groups' names
     * @param {string} eraserLabel @param {() => void} onEraser
     * @param {(c: Color) => void} onPick @param {HTMLElement} end
     * @param {HTMLElement} [middle] between the eraser and the end
     */
    const styleRows = (prefix, what, eraserLabel, onEraser, onPick, end, middle) => {
      const colors = COLORS.map((c) => toggle(`${prefix}-color-${c}`, capitalise(c), `swatch-tool ink-${c}`, () => onPick(c),
        h("span", { className: "swatch-dot", "aria-hidden": "true" })));
      const widths = WIDTHS.map((w) => toggle(`${prefix}-width-${w}`, WIDTH_NAMES[w], "width-tool", () => pickWidth(w),
        h("span", { className: `width-sample width-${w}`, "aria-hidden": "true" })));
      const eraser = toggle(`${prefix}-eraser`, eraserLabel, "width-tool icon-tool", onEraser, TOOL_ICONS.eraser());
      const element = h("div", { className: "pose-rope-tools-rows" },
        h("div", { className: "pose-tools-row" },
          h("div", { className: "tool-group pose-rope-tools", role: "group", "aria-label": `${what} thickness` }, widths, eraser),
          ...(middle ? [middle] : []), end),
        h("div", { className: "tool-group", role: "group", "aria-label": `${what} color` }, colors));
      return { element, colors, widths, eraser };
    };
    // The hardpoint's chip: which there is (its icon and name), or + Hardpoint,
    // and tapping it opens Scene to change it.
    const hardpointLink = h("button", { type: "button", className: "tool pose-hardpoint-chip", id: "pose-hardpoint-link", onclick: () => setMode("scene") });
    // Dangle: a body in the air comes to rest under its uplines, as one
    // piece (pose-hang.js). Changing an upline's Length does it too; this is
    // for after posing, which never moves the body by itself. In the
    // thickness row, between the eraser and the hardpoint's chip.
    const hangButton = h("button", { type: "button", className: "tool pose-hang", id: "pose-hang", hidden: true, title: "The body comes to rest under its uplines", onclick: () => {
      const hung = hang(history.pose);
      if (samePose(hung, history.pose)) {
        sayRope("It's hanging as low as its lines allow.");
        return;
      }
      commit(hung, true);
      sayRope("");
    } }, "Dangle");
    const ropeStyle = styleRows("pose", "Rope", "Eraser: tap a rope to take it out", () => setErasing(!erasing), (c) => pickColor(c),
      hardpointLink, hangButton);
    const { colors: colorButtons, widths: widthButtons, eraser: eraserButton } = ropeStyle;
    // While a rope is laid: its count, Cancel and Finish, in a bar over the
    // foot of the view (hidden otherwise).
    const finishButton = h("button", {
      type: "button", className: "tool pose-finish", id: "pose-finish-rope", onclick: () => { endRope(true); drawAll(); },
    }, "Finish");
    // Drops the rope, cinch or added rope being laid.
    const cancelButton = h("button", { type: "button", className: "tool pose-cancel-rope", id: "pose-cancel-rope", onclick: () => {
      cancelRope();
      sayRope("");
      drawAll();
    } }, "Cancel");
    const layingCount = h("span", { className: "pose-bar-text", id: "pose-laying-count" });
    const layingBar = h("div", { className: "pose-view-bar", id: "pose-laying-bar", hidden: true }, layingCount, cancelButton, finishButton);
    const ropeTools = ropeStyle.element;
    const ropeHintLine = h("p", { className: "hint", id: "pose-rope-hint" });
    const ropeNote = h("p", { className: "message pose-rope-note", id: "pose-rope-note", "aria-live": "polite" });
    /** A message about the ropes, under the help. @param {string} text @param {boolean} [isError] */
    const sayRope = (text, isError = false) => showMessage(ropeNote, text, isError);
    // The rope chosen (pose-rope-panel.js), in place of the tools.
    const ropeOptions = h("div", { className: "pose-rope-options", id: "pose-rope-options" });
    // Wrap: with it on, a tap on the body lays a turn round that part, and
    // + and − (stacked, as a slider's ▲▼ are) set how many turns, shown as
    // a number. It floats over the view, top middle, between undo and redo
    // and the views (the Rope tab's rows keep their places, which the
    // pencil's share), clear of the bar a rope being laid has along the foot.
    const wrapToggle = h("button", { type: "button", className: "pose-float-button pose-wrap", id: "pose-wrap", "aria-pressed": "false", title: "Wrap: a tap lays a turn of rope round the part", onclick: () => {
      wrapping = !wrapping;
      drawAll();
    } }, "Wrap");
    const wrapNumber = h("span", { "aria-hidden": "true" }, "1");
    const wrapWords = h("span", { className: "visually-hidden" }, "1 turn");
    const wrapCount = h("span", { className: "pose-wrap-count", id: "pose-wrap-count", "aria-live": "polite" }, wrapNumber, wrapWords);
    const wrapStep = (/** @type {number} */ by) => () => {
      wrapTurns = Math.min(MAX_WRAPS, Math.max(1, wrapTurns + by));
      drawAll();
    };
    const wrapFewer = h("button", { type: "button", className: "pose-wrap-step", id: "pose-wrap-fewer", "aria-label": "Fewer turns", title: "Fewer turns", onclick: wrapStep(-1) }, "−");
    const wrapMore = h("button", { type: "button", className: "pose-wrap-step", id: "pose-wrap-more", "aria-label": "More turns", title: "More turns", onclick: wrapStep(1) }, "+");
    const wrapRow = h("div", { className: "pose-view-tools pose-wrap-row", role: "group", "aria-label": "Wrap", hidden: true },
      wrapToggle, h("div", { className: "pose-wrap-steps" }, wrapMore, wrapFewer), wrapCount);
    const ropePanel = h("div", { className: "pose-panel", id: "pose-panel-rope", hidden: true },
      ropeTools, ropeOptions, ropeHintLine, ropeNote);

    // --- the Pencil panel ------------------------------------------------------------

    // While the pencil's on, in place of the tab's panel: the Rope tab's
    // rows (its own eraser and color, for marks), in the same place, with
    // Done (the pencil's icon on it) where ropes have the hardpoint's chip.
    const drawDone = h("button", {
      type: "button", className: "tool pose-finish pose-draw-done", id: "pose-draw-done", "aria-label": "Done drawing", onclick: () => setDrawing(false),
    }, TOOL_ICONS.pencil(), "Done");
    const markStyle = styleRows("pose-mark", "Line", "Eraser: tap or drag over a mark to take it out", () => setErasingMarks(!erasingMarks),
      (c) => pickMarkColor(c), drawDone);
    const { colors: markColorButtons, widths: markWidthButtons, eraser: markEraserButton } = markStyle;
    const drawPanel = h("div", { className: "pose-panel", id: "pose-panel-draw", hidden: true },
      markStyle.element,
      h("p", { className: "hint", id: "pose-draw-hint" }, "Pencil: marks go in pictures and hide when the view turns."));

    // The view, with its tools and bars over it.
    const frame = h("div", { className: "pose-frame" }, view.canvas, beside.svg, marks.svg,
      // Across the top: undo, redo and the pencil; Wrap (Rope) in the middle; the views.
      h("div", { className: "pose-view-top" },
        h("div", { className: "pose-view-tools", role: "group", "aria-label": "View tools" },
          undoButton, redoButton, h("span", { className: "pose-view-divider", "aria-hidden": "true" }), drawTab),
        wrapRow, viewMenu),
      viewList,
      h("div", { className: "pose-view-foot" }, viewHintLine, allowLabel),
      layingBar);

    // The panels scroll when they're taller than their space: their bottom
    // edge fades while there's more below, so it's clear there is.
    const panels = h("div", { className: "pose-panels", id: "pose-panels" }, posePanel, ropePanel, scene.element, drawPanel);
    const fadePanels = () => panels.classList.toggle("more-below", panels.scrollTop + panels.clientHeight < panels.scrollHeight - 2);
    panels.addEventListener("scroll", fadePanels, { passive: true });

    const dialog = h("dialog", { className: "pose-editor", "aria-labelledby": "pose-heading" },
      // The heading takes focus when it opens, as other dialogs' do, so no
      // button starts out ringed as if it had been tabbed to.
      h("h2", { id: "pose-heading", className: "visually-hidden", tabIndex: -1, autofocus: true }, start ? "Edit pose" : "New pose"),
      h("div", { className: "pose-tools pose-tabs", role: "group", "aria-label": "Mode" }, poseTab, ropeTab, sceneTab),
      frame,
      panels,
      message,
      h("div", { className: "drawing-actions pose-actions" },
        h("button", { type: "button", id: "pose-cancel", onclick: cancel }, "Close"),
        downloadButton,
        addVisualButton,
        h("button", {
          type: "button", className: "primary", id: "pose-save", onclick: save, disabled: standalone && !place,
        }, "Save pose")));
    // Tapping anywhere but the cube closes its list.
    dialog.addEventListener("pointerdown", (event) => {
      if (!viewList.hidden && !viewList.contains(/** @type {Node} */ (event.target)) && !viewMenu.contains(/** @type {Node} */ (event.target))) {
        showViews(false);
      }
    });

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
        view.show(pose, {
          laying, selected: mode === "pose" ? selected : null, rope: mode === "rope" ? chosen?.index ?? -1 : -1, clash, warn: allowCollisions,
          spot: mode === "rope" ? chosenSpot() : null, point: mode === "rope" ? chosenPoint() : -1,
        });
        view.draw();
        drawBeside(pose);
        marks.draw([...(marksShow(pose.marks, pose.camera) ? /** @type {import("./pose-marks.js").Marks} */ (pose.marks).strokes : []),
          ...(markLine ? [markLine] : [])]);
      });
    }

    /** The chosen rope's point chosen, if it's still one on the body (an undo can take it away), or -1. */
    function chosenPoint() {
      const rope = chosen && !laying ? current().ropes[chosen.index] : null;
      return rope && chosen?.point !== undefined && onBody(rope, chosen.point) ? chosen.point : -1;
    }

    /**
     * The marks over the view: the ‹ and › beside the point chosen, where a
     * point would be added, the chosen rope's dots' layers above 0, and the
     * × at the spot a cinch or an added rope starts from (the ‹ › and × no
     * taller than a medium rope looks there).
     * @param {Pose} pose
     */
    function drawBeside(pose) {
      const k = mode === "rope" && !drawing ? chosenPoint() : -1;
      const rope = chosen && mode === "rope" && !laying ? pose.ropes[chosen.index] : null;
      /** @type {import("./pose-beside-ui.js").BesideMark[]} */
      const marks = [];
      if (rope && k >= 0) {
        posed(measuring, pose);
        for (const side of /** @type {const} */ ([-1, 1])) {
          const spot = besidePoint(measuring, pose, /** @type {number} */ (chosen?.index), k, side);
          const at = spot && view.screenAt(spot.at);
          if (spot && at) marks.push({ side, x: at[0], y: at[1], size: view.pxAcross(spot.at, 2 * ROPE_RADIUS[2]) });
        }
      }
      const layers = rope ? view.handleSpots().flatMap(({ k: n, x, y }) => (layerOf(rope.p[n]) ? [{ x, y, layer: layerOf(rope.p[n]) }] : [])) : [];
      beside.draw(marks, layers, mode === "rope" ? view.spotScreen() : null);
    }

    /**
     * Adds a point beside the one chosen (‹ before, › after), and chooses it.
     * @param {-1 | 1} side
     */
    function addPointBeside(side) {
      const k = chosenPoint();
      if (!chosen || k < 0) return;
      posed(measuring, history.pose);
      const added = addBeside(measuring, history.pose, chosen.index, k, side);
      if (added.pose === history.pose) return;
      chosen = { ...chosen, point: added.k };
      commit(added.pose);
    }

    /** The view and every control, after any change. */
    function drawAll() {
      // An undo can take the rope chosen away.
      if (chosen && chosen.index >= current().ropes.length) chosen = null;
      drawSoon();
      undoButton.disabled = history.past.length === 0 && !laying?.p.length;
      redoButton.disabled = history.future.length === 0;
      drawPosePanel();
      drawRopePanel();
      drawScenePanel();
      viewHintLine.textContent = viewHint({ tab: mode, drawing, laying: !!laying, chosen: !!chosen });
      // Allow collisions is the Pose tab's; the bars cover the foot of the view.
      allowLabel.hidden = mode !== "pose" || drawing;
      viewHintLine.hidden = !drawing && mode === "rope" && !!laying;
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
    /**
     * @param {Pose} pose
     * @param {boolean} [fine] its contact all counts as fine (a preset, a reset): see accepted
     */
    function commit(pose, fine = false) {
      draft = null;
      // Gravity on the feet the change moved (pose-gravity.js); a preset or
      // a reset is as it comes.
      if (!fine) pose = grounded(measuring, history.pose, pose);
      // A new body shape is fine as it comes too: a bigger body touches more.
      accepted = contactAccepted(measuring, pose, fine || !sameShape(pose.shape, history.pose.shape) ? undefined : accepted);
      history = change(history, pose);
      say("");
      drawAll();
    }

    /**
     * A move let go of: as it is with collisions allowed, or else with any
     * clash it made settled (pose-contact.js), and a limb left clashing
     * brought out too, now it's moved again.
     * @param {Pose} before @param {Pose} after @param {readonly string[]} moved
     */
    const settle = (before, after, moved) => (allowCollisions ? after : settleClashes(measuring, before, after, moved, accepted));

    /**
     * Ticking or unticking "Allow collisions". Unticked with clashes left,
     * or a joint further than a body can go: fixing them (as one change,
     * undone with Undo) or leaving them, until each is moved again.
     * @param {boolean} on
     */
    async function setAllowed(on) {
      allowCollisions = on;
      drawSoon();
      if (on) return;
      const pose = history.pose;
      const tooFar = Object.entries(pose.joints).some(([name, angles]) => !canReach(name, angles, pose.joints));
      if (!tooFar && clashesLeft(measuring, pose, accepted).size === 0) return;
      const choice = await choose({
        title: "Fix the collisions?",
        message: "Some body parts are pushed into each other, or bent further than a body can go. "
          + "Fix them now, or leave them as they are until you move them again.",
        choices: [{ label: "Fix them now", value: "fix" }],
        cancelLabel: "Leave them",
      });
      if (choice !== "fix" || allowCollisions) return;
      /** @type {Record<string, number[]>} */
      const joints = { ...pose.joints };
      for (const [name, angles] of Object.entries(pose.joints)) joints[name] = clampJoint(name, angles, undefined, joints, true);
      commit(fixClashes(measuring, { ...pose, joints }, accepted));
      say("Fixed: the body parts are back within reach and apart.");
    }

    /** @param {number[]} camera */
    function lookAt(camera) {
      history = look(history, setCamera(history.pose, camera));
      if (draft) draft = { ...draft, camera: history.pose.camera };
      drawSoon();
    }

    function doUndo() {
      // Laying a rope: the last point goes first (a cinch's or added rope's first, and it's stopped).
      if (laying?.p.length) {
        // A tap's worth: one point, or the whole wrap it laid.
        const before = layingTaps.pop() ?? laying.p.length - 1;
        laying = { ...laying, p: laying.p.slice(0, Math.min(before, laying.p.length - 1)) };
        if (!laying.p.length && layingKind !== "rope") cancelRope();
        drawAll();
        return;
      }
      history = undo(history);
      chosen = null;
      drawAll();
    }

    function doRedo() {
      history = redo(history);
      chosen = null;
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
        draft = grounded(measuring, history.pose, apply(history.pose, Number(input.value)));
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

    /** The Scene tab: the hardpoint pressed and its sliders, and the body's shape. */
    function drawScenePanel() {
      const pose = current();
      const kind = hardpointOf(pose);
      scene.draw({ hardpoint: kind, isDefault: sameShape(pose.shape, DEFAULT_SHAPE), isMine: sameShape(pose.shape, defaultShape ?? DEFAULT_SHAPE) });
      // A slider being dragged keeps its place (redrawing it would drop the drag).
      if (draft) return;
      scene.shapeSliders.replaceChildren(...SHAPE_SLIDERS.map(({ label }, i) => slider({
        id: `pose-shape-${i}`, label, min: SHAPE_RANGES[i][0], max: SHAPE_RANGES[i][1], value: pose.shape[i],
        apply: (p, v) => withShape(measuring, p, /** @type {import("./figure-body.js").Shape} */ (p.shape.map((n, k) => (k === i ? v : n)))),
      })));
      if (!kind) {
        scene.hardpointSliders.replaceChildren();
        return;
      }
      const ranges = HARDPOINT_RANGES[kind];
      // A bamboo's hangers stay on their own side of its middle.
      const top = (/** @type {number} */ i) => (kind === "bamboo" && i === 5 ? maxInset(/** @type {number[]} */ (pose.bamboo)[4]) : ranges[i][1]);
      scene.hardpointSliders.replaceChildren(...HARDPOINT_SLIDERS[kind].map((label, i) => slider({
        id: `pose-${kind}-${i}`, label, min: ranges[i][0], max: top(i),
        value: /** @type {number[]} */ (pose[kind])[i],
        apply: (p, v) => {
          const place = [.../** @type {number[]} */ (p[kind])];
          place[i] = v;
          return moveHardpoint(p, place);
        },
      })));
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
      const joint = /** @type {import("./figure-rig.js").Joint} */ (jointNamed(selected));
      const own = joint.moves.map((m, i) => slider({
        id: `pose-${joint.name}-${i}`, label: m.label, min: m.min, max: m.max, value: pose.joints[joint.name][i],
        // A see-saw rope's other end moves to keep it the same length; let
        // go, any clash is settled (pose-contact.js).
        // The Hips turn the pelvis keeping both legs and the trunk where they were (pose-skeleton.js).
        apply: joint.name === "hips"
          ? (p, v) => keepSeesaws(p, withHipsOn(measuring, p, p.joints.hips.map((a, k) => (k === i ? v : a))), HIPS_MOVE)
          : (p, v) => keepSeesaws(p, setJoint(p, joint.name, i, v), [joint.name]),
        settle: (before, after) => settle(before, after, joint.name === "hips" ? HIPS_MOVE : [joint.name]),
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
      if (joint.name === "hips") commit(withHipsOn(measuring, history.pose, startJoints().hips), true);
      else commit({ ...history.pose, joints: { ...history.pose.joints, [joint.name]: startJoints()[joint.name] } }, true);
    }

    /** Stands the whole body up, facing ahead, its feet on the floor for its body's height. */
    function resetWholeBody() {
      commit({ ...history.pose, body: [0, 0, 0], lift: Math.round(standingLift(history.pose.shape)), shift: [0, 0] });
    }

    function drawRopePanel() {
      const pose = current();
      const kind = hardpointOf(pose);
      const points = laying?.p.length ?? 0;
      const rope = chosen && !laying ? pose.ropes[chosen.index] : null;
      // Sliding along the bamboo ends when the rope's let go (or gone).
      if (sliding && (chosen?.index !== sliding.index || pose.ropes[sliding.index]?.p[sliding.point]?.[0] !== "bamboo" || !pose.bamboo)) {
        sliding = null;
      }
      // What's being laid: its count, Cancel and Finish over the view.
      layingBar.hidden = !laying || drawing || mode !== "rope";
      finishButton.disabled = !points;
      const count = `${points} ${points === 1 ? "point" : "points"}`;
      layingCount.textContent = layingKind === "cinch" ? `Cinch · ${count}` : layingKind === "added" ? `Added rope · ${count}` : `Laying rope · ${count}`;
      ropeHintLine.textContent = ropeHint({
        erasing, layingKind: laying ? layingKind : "rope", points, chosen: !rope ? "none" : !isCinch(rope) ? "rope" : pullsUplines(pose.ropes, rope) ? "cinch" : "body cinch",
        sliding: !!sliding, hardpoint: kind, wrapping,
      });
      drawHardpointChip(kind);
      // A rope chosen: its own panel in place of the tools.
      ropeTools.hidden = !!rope;
      // Wrap is for laying a rope or an added one: not with a rope chosen, the eraser, or a cinch.
      wrapRow.hidden = mode !== "rope" || drawing || !!rope || erasing || (!!laying && layingKind === "cinch");
      wrapToggle.setAttribute("aria-pressed", String(wrapping));
      wrapNumber.textContent = String(wrapTurns);
      wrapWords.textContent = `${wrapTurns} ${wrapTurns === 1 ? "turn" : "turns"}`;
      wrapFewer.disabled = !wrapping || wrapTurns <= 1;
      wrapMore.disabled = !wrapping || wrapTurns >= MAX_WRAPS;
      if (draft) return;
      hangButton.hidden = !!laying || !canHang(pose);
      drawRopeOptions(pose);
    }

    /**
     * The hardpoint's chip: its icon, its name and ›, or + Hardpoint (dashed)
     * when there's none.
     * @param {import("./pose-format.js").Hardpoint | null} kind
     */
    function drawHardpointChip(kind) {
      if (hardpointLink.dataset.kind === (kind ?? "")) return;
      hardpointLink.dataset.kind = kind ?? "";
      hardpointLink.classList.toggle("empty", !kind);
      hardpointLink.setAttribute("aria-label", kind ? `Hardpoint: ${kind}. Change in Scene` : "Add a hardpoint in Scene");
      hardpointLink.title = kind ? "Change the hardpoint in Scene" : "Add a ring, bamboo or hashira in Scene";
      hardpointLink.replaceChildren(...(kind
        ? [TOOL_ICONS[kind](), h("span", { className: "pose-hardpoint-name" }, capitalise(kind)), TOOL_ICONS.chevron()]
        : ["+ Hardpoint"]));
    }

    /**
     * The Length slider's range, kept while the same rope stays chosen (so
     * it doesn't move under the finger as the rope changes).
     * @type {{ chosen: object, max: number } | null}
     */
    let lengthRange = null;

    /**
     * The chosen rope's panel (pose-rope-panel.js): its see-saw box, Cinch,
     * Slide (tied to the bamboo) and Add rope, and the setting in play:
     * sliding it along the bamboo, its slack, a two-point rope's length,
     * or a cinch's length (and
     * whether it moves the body).
     * @param {Pose} pose
     */
    function drawRopeOptions(pose) {
      const rope = chosen && !laying ? pose.ropes[chosen.index] : null;
      if (!chosen || !rope) {
        ropeOptions.replaceChildren();
        return;
      }
      const index = chosen.index;
      const letGo = () => {
        chosen = null;
        sliding = null;
        drawAll();
      };
      // The eye: the whole rope drawn see-through, or solid again.
      const seeThrough = { on: !!rope.t, onChange: (/** @type {boolean} */ on) => commit(setSeeThrough(history.pose, index, on)) };
      // Delete rope: the whole rope, as one change (Undo brings it back).
      const onDelete = () => {
        chosen = null;
        sliding = null;
        commit(removeRope(history.pose, index));
        sayRope("Rope deleted.");
      };
      // The point row, always there: the point chosen (its dot tapped), its
      // layer, points beside it, Remove point; with none, greyed out.
      const k = chosenPoint();
      posed(measuring, pose);
      const none = () => {};
      const point = k < 0 ? { chosen: false, layer: 0, onLayer: none, onBefore: null, onAfter: null, onRemove: none } : {
        chosen: true,
        layer: layerOf(rope.p[k]),
        onLayer: (/** @type {number} */ layer) => commit(setLayer(history.pose, index, k, layer)),
        onBefore: besidePoint(measuring, pose, index, k, -1) ? () => addPointBeside(-1) : null,
        onAfter: besidePoint(measuring, pose, index, k, 1) ? () => addPointBeside(1) : null,
        onRemove: () => takeOutPoint(index, k),
      };
      if (isCinch(rope)) {
        posed(measuring, pose);
        const span = Math.max(1, Math.round(cinchPoints(measuring, pose, index).span));
        // Moving the body: on uplines, keeping their lengths; round the
        // body, drawing the parts it's tied to together.
        const still = !!rope.still;
        ropeOptions.replaceChildren(...chosenRopeView({
          color: rope.c, seesaw: null, slide: "none", onLetGo: letGo, seeThrough, onDelete, point,
          // Cinch is pressed: tapping it again is done with it.
          onCinch: letGo, onSlide: () => {}, onAddRope: () => {},
          cinch: { still, onStill: (on) => commit({
            ...history.pose, ropes: history.pose.ropes.map((r, i) => {
              if (i !== index) return r;
              const { still: _, ...moving } = r;
              return on ? { ...moving, still: /** @type {true} */ (true) } : moving;
            }),
          }) },
          settings: slider({
            id: "pose-cinch-length", label: "Length (cm)", min: 0, max: span, value: Math.min(/** @type {number} */ (rope.l), span),
            apply: (p, v) => (still ? setCinchLength(p, index, v) : cinchBody(p, index, v)),
          }),
        }));
        return;
      }
      const top = rope.p.find((p) => p[0] === "ring" || p[0] === "bamboo")?.[0] ?? "hardpoint";
      const onBamboo = bambooEnd(rope, chosen.segment);
      /** @type {HTMLElement | null} */
      let settings = null;
      if (sliding && pose.bamboo) {
        const { point } = sliding;
        const half = Math.floor(pose.bamboo[4] / 2);
        settings = slider({
          id: "pose-along-bamboo", label: "Position (cm)", min: -half, max: half,
          value: Math.round(rope.p[point][1] / 10), apply: (p, v) => moveAlongBamboo(p, index, point, v),
        });
      } else if (uplineStretch(pose, index, chosen.segment) >= 0) {
        // An upline's hanging stretch has a Length, raising and lowering
        // what it's tied to: shorter lifts it (the other uplines keeping
        // theirs), longer lowers it to the floor, the rest slack.
        const stretch = uplineStretch(pose, index, chosen.segment);
        posed(measuring, pose);
        const now = Math.round(uplineLength(measuring, pose, index, stretch));
        if (lengthRange?.chosen !== chosen) lengthRange = { chosen, max: Math.max(2, 2 * now) };
        settings = slider({
          id: "pose-length", label: "Length (cm)", min: 0, max: lengthRange.max, value: Math.min(now, lengthRange.max),
          apply: (p, v) => setUplineLength(p, index, stretch, v),
          // Let go, a body in the air comes to rest under its lines (pose-hang.js).
          settle: (_before, after) => hang(after),
        });
      } else if (hasLength(rope)) {
        // A rope of two points has a Length: from none to twice as long as
        // it was when chosen, starting in the middle. Shorter moves the
        // body to bring its ends together; longer gives it slack.
        posed(measuring, pose);
        const now = Math.round(ropeLength(measuring, pose, index));
        if (lengthRange?.chosen !== chosen) lengthRange = { chosen, max: Math.max(2, 2 * now) };
        settings = slider({
          id: "pose-length", label: "Length (cm)", min: 0, max: lengthRange.max, value: Math.min(now, lengthRange.max),
          apply: (p, v) => setRopeLength(p, index, v),
        });
      } else if (seesawSides(pose, index)) {
        // A see-saw keeps its whole length: the slider is how much of it is
        // on the start side (the rope's first point up to the hardpoint).
        // Toward Start shortens that side, raising its end, and lowers the
        // other end; let go, it shows where the body got to. (Its whole
        // length changes with the see-saw switched off.)
        posed(measuring, pose);
        const lengths = /** @type {{ start: number, total: number }} */ (seesawLengths(measuring, pose, index));
        if (lengthRange?.chosen !== chosen) lengthRange = { chosen, max: Math.max(2 * SEESAW_END + 2, Math.round(lengths.total)) };
        const [min, max] = [SEESAW_END, lengthRange.max - SEESAW_END];
        settings = slider({
          id: "pose-seesaw-start", label: "Start ◀ ▶ End", min, max, value: clamp(Math.round(lengths.start), [min, max]),
          apply: (p, v) => setSeesawStart(p, index, v),
        });
      } else if (isUpline(rope)) {
        // An upline with nothing on the body to lift (hanging from a spot on
        // a rope that's only between hardpoints), or a see-saw a side of
        // which doesn't reach the body: a Length that only grows, as slack.
        const tapped = hangs(rope, chosen.segment) ? chosen.segment : rope.p.findIndex((_, s) => hangs(rope, s));
        posed(measuring, pose);
        const taut = Math.round(segmentLength(measuring, pose, index, tapped));
        settings = slider({
          id: "pose-length", label: "Length (cm)", min: taut, max: taut + SLACK_RANGE[1], value: taut + (rope.k ?? 0),
          apply: (p, v) => setSlack(p, index, v - taut),
        });
      }
      ropeOptions.replaceChildren(...chosenRopeView({
        color: rope.c, cinch: null, onLetGo: letGo, onCinch: startCinch, onAddRope: startAdded, settings, seeThrough, onDelete, point,
        seesaw: canSeesaw(rope) ? { over: top, on: !!rope.s, onChange: (on) => commit(setSeesaw(history.pose, index, on)) } : null,
        slide: onBamboo < 0 ? "none" : sliding?.index === index ? "on" : "off",
        onSlide: () => {
          sliding = sliding?.index === index ? null : { index, point: onBamboo };
          drawAll();
        },
      }));
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

    /** The spot chosen on a rope (the dot), or a cinch's or added rope's first point while it's laid. @returns {RopePoint | null} */
    function chosenSpot() {
      if (laying && layingKind !== "rope") return laying.p[0] ?? null;
      if (!chosen) return null;
      return isCinch(current().ropes[chosen.index]) ? null : ropeSpot(chosen.index, chosen.segment, chosen.along);
    }

    /** "Add cinch": a cinch laid from the dot, point by point, tied when finished. */
    function startCinch() {
      if (!chosen) return;
      laying = { c: color, w: width, p: [ropeSpot(chosen.index, chosen.segment, chosen.along)] };
      layingKind = "cinch";
      chosen = null;
      sliding = null;
      sayRope("");
      drawAll();
    }

    /** "Add rope": a new rope tied on at the dot, laid as any rope is. */
    function startAdded() {
      if (!chosen) return;
      const problem = cantAddTo(history.pose, chosen.index);
      if (problem) {
        sayRope(problem, true);
        return;
      }
      laying = { c: color, w: width, p: [ropeSpot(chosen.index, chosen.segment, chosen.along)] };
      layingKind = "added";
      chosen = null;
      sliding = null;
      sayRope("");
      drawAll();
    }

    /** Drops what's being laid. */
    function cancelRope() {
      laying = null;
      layingKind = "rope";
      layingTaps = [];
    }

    // --- modes and tools -------------------------------------------------------

    /** @param {"pose" | "rope" | "scene"} next */
    function setMode(next) {
      // A tab tapped while drawing puts the pencil away first.
      if (drawing) setDrawing(false);
      if (next !== "rope") {
        endRope();
        chosen = null;
        sliding = null;
      }
      mode = next;
      poseTab.setAttribute("aria-pressed", String(mode === "pose"));
      ropeTab.setAttribute("aria-pressed", String(mode === "rope"));
      sceneTab.setAttribute("aria-pressed", String(mode === "scene"));
      showPanel();
      if (mode === "rope") setErasing(false);
      drawAll();
    }

    /** The tab's panel, or the pencil's in its place while it's on. */
    function showPanel() {
      posePanel.hidden = drawing || mode !== "pose";
      ropePanel.hidden = drawing || mode !== "rope";
      scene.element.hidden = drawing || mode !== "scene";
      drawPanel.hidden = !drawing;
    }

    /**
     * The pencil on or off, over whichever tab is shown: while it's on, the
     * marks take the view's taps, so fingers only draw, and its panel
     * takes the tab's place.
     * @param {boolean} on
     */
    function setDrawing(on) {
      drawing = on;
      drawTab.setAttribute("aria-pressed", String(on));
      showPanel();
      marks.svg.classList.toggle("drawing", on);
      if (on) {
        // A rope being laid is finished (or dropped) first, as leaving Rope does.
        endRope();
        setErasingMarks(false);
      }
      drawAll();
    }

    /** @param {boolean} on */
    function setErasingMarks(on) {
      erasingMarks = on;
      marks.svg.classList.toggle("erasing", on);
      for (const [i, button] of markColorButtons.entries()) button.setAttribute("aria-pressed", String(!on && COLORS[i] === markColor));
      for (const [i, button] of markWidthButtons.entries()) button.setAttribute("aria-pressed", String(!on && WIDTHS[i] === width));
      markEraserButton.setAttribute("aria-pressed", String(on));
      for (const button of markWidthButtons) button.className = `tool width-tool ink-${markColor}`;
    }

    /** A rope color. @param {Color} c */
    function pickColor(c) {
      color = lastRopeColor = c;
      if (laying) laying = { ...laying, c };
      setErasing(false);
      drawSoon();
    }

    /** The pencil's color. @param {Color} c */
    function pickMarkColor(c) {
      markColor = lastMarkColor = c;
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
      }
      erasing = on;
      for (const [i, button] of colorButtons.entries()) button.setAttribute("aria-pressed", String(!on && COLORS[i] === color));
      for (const [i, button] of widthButtons.entries()) button.setAttribute("aria-pressed", String(!on && WIDTHS[i] === width));
      eraserButton.setAttribute("aria-pressed", String(on));
      for (const button of widthButtons) button.className = `tool width-tool ink-${color}`;
      drawAll();
    }

    /**
     * Ends the rope being laid: it's a change if it has two points or more.
     * A cinch is tied, taut (as long as its line), and chosen, to be
     * shortened; one that can't be is kept to go on with when Finish rope
     * was tapped, or dropped (leaving Rope mode, say).
     * @param {boolean} [asked] Finish rope was tapped
     */
    function endRope(asked = false) {
      if (!laying) return;
      const rope = laying;
      const kind = layingKind;
      if (kind === "cinch") {
        const problem = cantCinch(history.pose, rope.p);
        if (problem) {
          if (asked) {
            sayRope(problem, true);
            return;
          }
          cancelRope();
          sayRope("That cinch wasn't finished, so it was left out.");
          return;
        }
        cancelRope();
        const taut = addCinch(history.pose, { c: rope.c, w: rope.w }, rope.p, 0);
        const index = taut.ropes.length - 1;
        posed(measuring, taut);
        commit(setCinchLength(taut, index, Math.round(cinchPoints(measuring, taut, index).span)));
        chosen = { index, segment: 0, along: 0.5 };
        sayRope(pullsUplines(taut.ropes, taut.ropes[index]) ? "Cinch tied. Shorten it to pull the upline aside." : "Cinch tied. Shorten it to draw them together.");
        return;
      }
      cancelRope();
      if (rope.p.length >= 2) commit(finishRope(history.pose, rope));
      else if (rope.p.length === 1) sayRope("A rope needs two points or more, so that one was left out.");
    }

    /**
     * Adds this hardpoint in place of any other, or takes it away if it's
     * there (and puts it back where it starts when tapped once more).
     * @param {import("./pose-format.js").Hardpoint} kind
     */
    function toggleHardpoint(kind) {
      endRope();
      chosen = null;
      sliding = null;
      const now = hardpointOf(history.pose);
      const next = now === kind ? null : kind;
      // No question first: rope points that can't move go, and Undo brings them back.
      const lost = hardpointPointsLost(history.pose, next);
      // A new hashira goes just behind the body, wherever it's standing.
      const place = next === "hashira" ? behindBody(measuring, history.pose) ?? undefined : undefined;
      commit(setHardpoint(history.pose, next, place));
      if (now && lost > 0) say(hardpointLostNote(now, lost));
    }

    /** A picture of the pose as it is now, with the pencil marks showing on it. */
    async function picture() {
      const pose = history.pose;
      const blob = await poseImage(pose, PICTURE);
      return marksShow(pose.marks, pose.camera) ? withMarks(blob, /** @type {import("./pose-marks.js").Marks} */ (pose.marks).strokes, PICTURE) : blob;
    }

    let adding = false;
    /**
     * Opened on its own: the pose as it was when last put somewhere (Save
     * pose, or Add to visuals for its picture), so Close only asks when
     * it's changed since.
     * @type {Pose | null}
     */
    let placedPose = null;

    /** "Add to visuals": a picture of the pose as it is now. */
    async function addPicture() {
      if (adding) return;
      if (standalone && place) {
        await placeIt(async () => ({ picture: await picture() }), "Adding a picture to the visuals…");
        return;
      }
      if (!addToVisuals) return;
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

    /**
     * Opened on its own: asks where to put the pose or its picture, and
     * says how it went, the poser staying open.
     * @param {() => Promise<{ pose: Pose } | { picture: Blob }>} make
     * @param {string} working what to say while it's saved
     */
    async function placeIt(make, working) {
      if (!place || adding) return;
      adding = true;
      const buttons = [addVisualButton, /** @type {HTMLButtonElement | null} */ (dialog.querySelector("#pose-save"))];
      for (const b of buttons) if (b) b.disabled = true;
      try {
        const pose = history.pose;
        const placing = await make();
        const placed = await place(placing, () => say(working));
        if (!dialog.open) return; // closed meanwhile (the journal locked)
        say(placed?.text ?? "", placed ? !placed.saved : false);
        if (placed?.saved) placedPose = pose;
      } catch (err) {
        if (dialog.open) say("Couldn't save it: " + (err instanceof Error ? err.message : String(err)), true);
      } finally {
        adding = false;
        for (const b of buttons) if (b) b.disabled = false;
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
        } else if (!hit && selected) {
          // Off the body: the part's let go, and the panel's as it opens.
          selected = null;
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
      // Laying a cinch: a rope tapped is a spot on it, the body a point on it.
      if (laying && layingKind === "cinch") {
        addCinchPoint(view.pick(x, y, { ropes: true }));
        return;
      }
      // A ‹ or › beside the point chosen adds a point there.
      const side = !laying?.p.length && chosenPoint() >= 0 ? beside.markAt(x, y) : 0;
      if (side) {
        addPointBeside(side);
        return;
      }
      // Not laying a rope: tapping one chooses it (and tapping it again,
      // or anywhere else, lets it go).
      if (!laying?.p.length) {
        const onRope = view.pick(x, y, { ropes: true });
        if (onRope?.kind === "rope") {
          posed(measuring, history.pose);
          chosen = chosen?.index === onRope.index ? null : { index: onRope.index, ...spotOn(measuring, history.pose, onRope.index, onRope.point) };
          sayRope("");
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
        sayRope(problem, true);
        return;
      }
      const point = hit.kind === "ring" ? RING_POINT
        : hit.kind === "bamboo" ? bambooPoint(hit.along, /** @type {number[]} */ (history.pose.bamboo)[4])
          : hit.kind === "hashira" ? hashiraPoint(hit.mm) : bonePoint(hit.bone, hit.mm);
      const started = laying ?? { c: color, w: width, p: [] };
      // Wrap: a turn (or several) round the part tapped, from the tap.
      const turn = wrapping && hit.kind === "body" ? wrapPoints(hit.bone, hit.point) : [];
      if (started.p.length + turn.length > MAX_ROPE_POINTS) {
        sayRope(`A rope can have at most ${MAX_ROPE_POINTS} points. Finish this one and start another.`, true);
        return;
      }
      layingTaps.push(started.p.length);
      laying = (turn.length ? turn : [point]).reduce(addPoint, started);
      sayRope("");
      drawAll();
    }

    /**
     * A wrap's points round the part tapped, each kept on that part; none
     * when it can't be wrapped (the tap lays one point).
     * @param {string} bone the part tapped
     * @param {import("./vendor/three.js").Vector3} at where, on its skin
     * @returns {RopePoint[]}
     */
    function wrapPoints(bone, at) {
      posed(measuring, history.pose);
      // Each turn a rope's width along from the last.
      // On the real skin, as the view has it, where the capsules are only near it.
      return wrapRound(skinOf(measuring), bone, at, wrapTurns, ROPE_RADIUS[width] * 2.2, view.skinMeasure(bone))
        .map((v) => bonePoint(bone, toBone(measuring, bone, v)));
    }

    /**
     * The next point of the cinch being laid: a spot on the rope tapped
     * (where it's drawn, nearest the tap), or a point on the body.
     * @param {import("./pose-scene.js").Hit | null} hit
     */
    function addCinchPoint(hit) {
      if (!laying) return;
      /** @type {RopePoint | null} */
      let point = null;
      if (hit?.kind === "rope") {
        posed(measuring, history.pose);
        const { segment, along } = spotOn(measuring, history.pose, hit.index, hit.point);
        point = ropeSpot(hit.index, segment, along);
      } else if (hit?.kind === "body") {
        point = bonePoint(hit.bone, hit.mm);
      } else if (hit) {
        point = hit.kind === "ring" ? RING_POINT : hit.kind === "bamboo" ? ["bamboo", 0, 0, 0] : ["hashira", 0, 0, 0];
      }
      if (!point) return;
      const problem = cantCinchAt(history.pose, point) ?? cantAdd(history.pose, laying);
      if (problem) {
        sayRope(problem, true);
        return;
      }
      layingTaps.push(laying.p.length);
      laying = addPoint(laying, point);
      sayRope("");
      drawAll();
    }

    /** The pointers down on the view, where each started and is now. @type {Map<number, { x0: number, y0: number, x: number, y: number }>} */
    const pointers = new Map();
    let dragged = false;
    /**
     * A limb being dragged (Pose mode, one finger that started on an arm or
     * a leg): the part held, the point held on it, and the flat surface
     * facing the camera it moves on. The head held moves the whole body up
     * and down (its Height), on an upright surface facing the camera.
     * @type {{ bone: string, cm: [number, number, number], through: import("./vendor/three.js").Vector3,
     *   normal: import("./vendor/three.js").Vector3, lifting?: boolean } | null}
     */
    let limb = null;
    /** The dragged limb's pose, before any see-saw follows it. @type {Pose | null} */
    let limbPose = null;
    /**
     * A point of the chosen rope held by its dot (Rope mode): dragged, it
     * moves over the skin; tapped, it's taken out.
     * @type {{ index: number, k: number } | null}
     */
    let held = null;
    /** The two-finger gesture's last spread and middle. @type {{ spread: number, x: number, y: number } | null} */
    let pinch = null;

    /**
     * The limb under a finger put down, to drag (and it's selected, so its
     * sliders show), or null for anything else, which turns the view.
     * @param {number} x @param {number} y CSS px from the canvas's corner
     */
    function grab(x, y) {
      const hit = view.pick(x, y);
      if (hit?.kind !== "body") return null;
      const cm = /** @type {[number, number, number]} */ (hit.mm.map((n) => n / 10));
      if (hit.bone === "head") {
        // Upright, so only up and down counts; a view from straight above
        // has none, and turns instead.
        const { direction } = view.ray(x, y);
        const normal = direction.clone().set(direction.x, 0, direction.z);
        if (normal.length() < 0.1) return null;
        return { bone: "head", cm, through: hit.point, normal: normal.multiplyScalar(1 / normal.length()), lifting: true };
      }
      if (!canDrag(hit.bone)) return null;
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
        const k = mode === "rope" && chosen && !laying && !sliding && !erasing && !drawing ? view.handleAt(x, y) : -1;
        held = k >= 0 && chosen ? { index: chosen.index, k } : null;
      }
      if (pointers.size === 2) {
        // A second finger turns a limb's drag into a pinch, putting it back.
        if (limb || held) {
          limb = null;
          limbPose = null;
          held = null;
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
        if (target && limb.lifting) {
          // Only the height: the head and chest stay as they are.
          draft = grounded(measuring, history.pose, setLift(history.pose, Math.round(history.pose.lift + target.y - limb.through.y)));
          drawSoon();
        } else if (target) {
          limbPose = dragTo(limbPose ?? history.pose, limb.bone, limb.cm, target, { from: history.pose });
          draft = grounded(measuring, history.pose, keepSeesaws(history.pose, limbPose, dragJoints(limb.bone)));
          drawSoon();
        }
        return;
      }
      if (held) {
        // The point follows the finger over the skin; off the body, it stays where it last was.
        const hit = view.pick(x, y);
        if (hit?.kind === "body") {
          draft = movePoint(history.pose, held.index, held.k, bonePoint(hit.bone, hit.mm));
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
        const held = limb.bone, lifting = limb.lifting;
        limb = null;
        limbPose = null;
        // A limb dragged is one change, any clash settled (pose-contact.js);
        // the body lifted by its head, one change too; let go of with a
        // cancel, it's put back.
        if (draft && event.type === "pointerup") {
          commit(lifting ? draft : settle(history.pose, draft, dragJoints(held)));
        } else if (draft) {
          draft = null;
          drawAll();
        }
      }
      if (held) {
        const { k } = held;
        held = null;
        if (event.type === "pointerup" && dragged && draft) {
          // Moved: one change. Its place along the rope is the same, so cinches on it stay.
          if (chosen) chosen = { ...chosen, point: k };
          commit(draft);
        } else if (event.type === "pointerup" && !dragged) {
          // Tapped: the point's chosen (again, it's let go).
          if (chosen) chosen = { ...chosen, point: chosen.point === k ? undefined : k };
          drawAll();
        } else if (draft) {
          draft = null;
          drawAll();
        }
        return;
      }
      if (event.type === "pointerup" && !dragged && pointers.size === 0) tap(p.x, p.y);
    };

    /**
     * Takes a point out of the chosen rope (its dot tapped). What was tied
     * on that rope goes with it, as their places along it are counted in
     * its points, and it says so; Undo brings it all back.
     * @param {number} index the rope's @param {number} k the point's
     */
    function takeOutPoint(index, k) {
      const before = history.pose.ropes;
      const whole = before[index].p.length <= 2;
      const next = removePoint(history.pose, index, k);
      // Still there: the rope stays chosen, on a stretch it still has, no point chosen.
      chosen = whole || !chosen ? null : { index: chosen.index, along: chosen.along, segment: Math.min(chosen.segment, next.ropes[index].p.length - 2) };
      commit(next);
      sayRope(pointGoneNote(before.length - next.ropes.length - (whole ? 1 : 0), whole));
    }
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
      if (!drawing || markPointer !== -1 || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      markPointer = event.pointerId;
      marks.svg.setPointerCapture(event.pointerId);
      if (erasingMarks) {
        erasedMarks = shownMarks();
        eraseMark(markPoint(event));
        return;
      }
      markLine = { c: markColor, w: width, p: markPoint(event) };
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
      const unchanged = standalone ? history.pose === placedPose || (!placedPose && history.past.length === 0) : history.past.length === 0;
      if (!unchanged || laying?.p.length) {
        const choice = await choose(standalone ? {
          title: "Close the poser?",
          message: placedPose
            ? "What you've changed since you last saved or added it isn't saved: Save pose or Add to visuals keeps it."
            : "This pose isn't saved yet: Save pose or Add to visuals keeps it, and Download keeps a picture of it.",
          choices: [{ label: "Close", value: "discard", style: "solid-danger" }],
        } : {
          title: "Discard your changes?",
          message: "What you've changed since opening this won't be saved.",
          choices: [{ label: "Discard changes", value: "discard", style: "solid-danger" }],
        });
        if (choice !== "discard") return;
      }
      dialog.close();
    }

    function save() {
      if (standalone) {
        endRope();
        placeIt(async () => ({ pose: forSaving(history.pose) }), "Saving the pose…");
        return;
      }
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
