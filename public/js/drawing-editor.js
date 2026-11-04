// The drawing pad: a dialog filling the screen, over the form it was opened
// from (a separate view would close that form, losing what's typed). Lines
// are drawn with a finger, pen or mouse, in a color and width chosen above
// the paper; the eraser takes out the whole line it touches. Undo and redo
// go back over everything since the pad opened, and Clear can be undone too.
// Download saves a picture of the drawing so far to the device, as a PNG.
//
// Nothing is saved here: editDrawing resolves with the new lines, and the
// Drawings section saves them.

import { h, showMessage } from "./dom.js";
import { capitalise, today } from "./format.js";
import { choose } from "./dialog.js";
import { PICK_COLORS as COLORS, MAX_STROKES, MAX_LINE_NUMBERS, drawing, toCanvas, simplify, strokePath } from "./drawing-format.js";
import { startHistory, change, undo, redo, strokeAt } from "./drawing-edit.js";
import { drawingSvg, strokeElement, drawingPng } from "./drawing-svg.js";
import { TOOL_ICONS } from "./tool-icons.js";
import { saveFile } from "./download.js";

/** @typedef {import("./drawing-format.js").Drawing} Drawing */
/** @typedef {import("./drawing-format.js").Stroke} Stroke */
/** @typedef {import("./drawing-format.js").Color} Color */
/** @typedef {import("./drawing-format.js").Width} Width */

const WIDTH_NAMES = /** @type {const} */ ({ 1: "Thin", 2: "Medium", 3: "Thick" });
/** Points closer than this (canvas units) to the last one aren't added while drawing. */
const MIN_STEP = 2;
/** How far around the eraser (canvas units) a line is caught. */
const ERASER_REACH = 14;

// The last color and width chosen, kept while the page is open.
/** @type {Color} */
let lastColor = "black";
/** @type {Width} */
let lastWidth = 2;

/**
 * Opens the pad on a drawing (or a blank one).
 * @param {Drawing | null} start
 * @returns {Promise<Drawing | null>} the new lines, or null if cancelled
 */
export function editDrawing(start) {
  return new Promise((resolve) => {
    let history = startHistory(start ? start.strokes : []);
    let color = lastColor;
    let width = lastWidth;
    let erasing = false;
    /** @type {Drawing | null} */
    let result = null;

    const message = h("p", { className: "message", id: "drawing-message", "aria-live": "polite" });
    const paper = drawingSvg(history.strokes, "drawing-pad");
    paper.setAttribute("id", "drawing-pad");
    paper.removeAttribute("aria-hidden");
    paper.setAttribute("role", "img");
    paper.setAttribute("aria-label", "Drawing area: draw with a finger, pen or mouse");
    const lines = /** @type {SVGGElement} */ (paper.querySelector(".lines"));

    /**
     * A toggle button in a group: aria-pressed marks the chosen one.
     * @param {string} id
     * @param {string} label
     * @param {string} className
     * @param {() => void} onclick
     * @param {...any} children
     */
    const toggle = (id, label, className, onclick, ...children) => h("button", {
      type: "button", id, className: `tool ${className}`.trim(), "aria-label": label, title: label, "aria-pressed": "false", onclick,
    }, ...children);
    const colorButtons = COLORS.map((c) => toggle(`drawing-color-${c}`, capitalise(c), `swatch-tool ink-${c}`, () => pickColor(c),
      h("span", { className: "swatch-dot", "aria-hidden": "true" })));
    const widthButtons = /** @type {Width[]} */ ([1, 2, 3]).map((w) => toggle(`drawing-width-${w}`, WIDTH_NAMES[w], "width-tool",
      () => pickWidth(w), h("span", { className: `width-sample width-${w}`, "aria-hidden": "true" })));
    const eraserButton = toggle("drawing-eraser", "Eraser: tap or drag over a line to remove it", "", () => setErasing(!erasing), "Eraser");
    /**
     * A button showing an icon, its name in aria-label and title.
     * @param {string} id @param {string} label @param {import("./tool-icons.js").ToolIcon} kind @param {() => void} onclick
     */
    const iconButton = (id, label, kind, onclick) => h("button", {
      type: "button", className: "tool icon-tool", id, "aria-label": label, title: label, onclick,
    }, TOOL_ICONS[kind]());
    const undoButton = iconButton("drawing-undo", "Undo", "undo", () => update(undo(history)));
    const redoButton = iconButton("drawing-redo", "Redo", "redo", () => update(redo(history)));
    const downloadButton = iconButton("drawing-download", "Download picture", "download", download);
    const clearButton = h("button", { type: "button", className: "tool", id: "drawing-clear", onclick: () => update(change(history, [])) }, "Clear");

    const dialog = h("dialog", { className: "drawing-editor", "aria-labelledby": "drawing-heading" },
      h("h2", { id: "drawing-heading", className: "visually-hidden" }, start ? "Edit drawing" : "New drawing"),
      h("div", { className: "drawing-tools" },
        h("div", { className: "tool-group", role: "group", "aria-label": "Color" }, colorButtons),
        h("div", { className: "tool-group", role: "group", "aria-label": "Line width" }, widthButtons, eraserButton),
        h("div", { className: "tool-group" }, undoButton, redoButton, downloadButton, clearButton)),
      h("div", { className: "drawing-pad-frame" }, paper),
      message,
      h("div", { className: "drawing-actions" },
        h("button", { type: "button", id: "drawing-cancel", onclick: cancel }, "Cancel"),
        h("button", { type: "button", className: "primary", id: "drawing-save", onclick: save }, "Save drawing")));

    // Esc asks first too, if anything changed.
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancel();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    dialog.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      update(event.shiftKey ? redo(history) : undo(history));
    });

    // --- drawing and erasing --------------------------------------------------

    /** The line being drawn, and its path on the paper. @type {{ stroke: Stroke, path: SVGPathElement } | null} */
    let current = null;
    /** The lines while the eraser is dragged, saved as one change when it lifts. @type {Stroke[] | null} */
    let erased = null;
    /** The pointer drawing or erasing (a second finger is ignored). */
    let pointerId = -1;

    // A point on the screen in canvas units, through the SVG's own
    // transform (so it's right wherever and however big the paper is shown).
    /** @param {PointerEvent} event */
    const pointAt = (event) => {
      const matrix = paper.getScreenCTM()?.inverse();
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
      return toCanvas(point);
    };

    paper.addEventListener("pointerdown", (event) => {
      if (pointerId !== -1 || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      pointerId = event.pointerId;
      paper.setPointerCapture(event.pointerId);
      const point = pointAt(event);
      if (erasing) {
        erased = history.strokes;
        eraseAt(point);
        return;
      }
      if (history.strokes.length >= MAX_STROKES) {
        showMessage(message, `A drawing can have at most ${MAX_STROKES.toLocaleString()} lines.`, true);
        pointerId = -1;
        return;
      }
      startLine(point);
    });
    paper.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) return;
      // The points in between, where the browser has them (a smoother line).
      const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
      for (const e of events.length ? events : [event]) {
        const point = pointAt(e);
        if (erased) eraseAt(point);
        else if (current) addPoint(point);
      }
    });
    paper.addEventListener("pointerup", finish);
    paper.addEventListener("pointercancel", finish);
    // No scrolling, zooming or the iPhone's hold menu while drawing.
    paper.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
    paper.addEventListener("contextmenu", (event) => event.preventDefault());

    /** @param {[number, number]} point */
    function startLine(point) {
      const stroke = { c: color, w: width, p: [...point] };
      current = { stroke, path: strokeElement(stroke) };
      lines.append(current.path);
    }

    /** @param {[number, number]} point */
    function addPoint([x, y]) {
      if (!current) return;
      const p = current.stroke.p;
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < MIN_STEP) return;
      // A very long line is split, so no one line is over the limit.
      if (p.length + 2 > MAX_LINE_NUMBERS) {
        endLine();
        startLine([p[p.length - 2], p[p.length - 1]]);
        return addPoint([x, y]);
      }
      p.push(x, y);
      current.path.setAttribute("d", strokePath(p));
    }

    /** Ends the line being drawn: simplified, and saved as a change. */
    function endLine() {
      if (!current) return;
      const stroke = { ...current.stroke, p: simplify(current.stroke.p) };
      current = null;
      update(change(history, [...history.strokes, stroke]));
    }

    /** @param {[number, number]} point */
    function eraseAt(point) {
      if (!erased) return;
      const i = strokeAt(erased, point, ERASER_REACH);
      if (i < 0) return;
      erased = erased.filter((_, j) => j !== i);
      lines.replaceChildren(...erased.map(strokeElement));
    }

    /** @param {PointerEvent} event */
    function finish(event) {
      if (event.pointerId !== pointerId) return;
      pointerId = -1;
      if (erased) {
        if (erased !== history.strokes) update(change(history, erased));
        erased = null;
      }
      endLine();
    }

    // --- tools ----------------------------------------------------------------

    /** @param {import("./drawing-edit.js").History} next */
    function update(next) {
      history = next;
      lines.replaceChildren(...history.strokes.map(strokeElement));
      undoButton.disabled = history.past.length === 0;
      redoButton.disabled = history.future.length === 0;
      clearButton.disabled = history.strokes.length === 0;
      downloadButton.disabled = history.strokes.length === 0;
      showMessage(message, "");
    }

    /** @param {Color} c */
    function pickColor(c) {
      color = lastColor = c;
      setErasing(false);
    }

    /** @param {Width} w */
    function pickWidth(w) {
      width = lastWidth = w;
      setErasing(false);
    }

    /** @param {boolean} on */
    function setErasing(on) {
      erasing = on;
      paper.classList.toggle("erasing", on);
      for (const [i, button] of colorButtons.entries()) button.setAttribute("aria-pressed", String(!on && COLORS[i] === color));
      for (const [i, button] of widthButtons.entries()) button.setAttribute("aria-pressed", String(!on && i + 1 === width));
      eraserButton.setAttribute("aria-pressed", String(on));
      // The width samples show the chosen color.
      for (const button of widthButtons) button.className = `tool width-tool ink-${color}`;
    }

    /** Saves a picture of the drawing so far to the device, as a PNG. */
    async function download() {
      try {
        saveFile(`notonawa-drawing-${today()}.png`, await drawingPng(history.strokes), "image/png");
      } catch (err) {
        showMessage(message, err instanceof Error ? err.message : String(err), true);
      }
    }

    async function cancel() {
      if (history.past.length > 0) {
        const choice = await choose({
          title: "Discard your changes?",
          message: "What you've drawn since opening this won't be saved.",
          choices: [{ label: "Discard changes", value: "discard", style: "solid-danger" }],
        });
        if (choice !== "discard") return;
      }
      dialog.close();
    }

    function save() {
      if (history.strokes.length === 0) {
        showMessage(message, "Draw something first.", true);
        return;
      }
      result = drawing(history.strokes);
      dialog.close();
    }

    document.body.append(dialog);
    dialog.showModal();
    setErasing(false);
    update(history);
  });
}
