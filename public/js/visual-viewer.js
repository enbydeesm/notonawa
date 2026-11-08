// What every visual's details dialog shares (a photo's or video's, a
// drawing's, a pose's): at the top, where it is in the item's visuals and
// ✕; under the picture, its caption, a big box that grows as it's typed in
// (and drags taller), its label in the placeholder, with a ✓ in its corner
// to save it once it's changed; then one row of icons: move earlier, move
// later, then (each in its place, left empty when a kind hasn't it) edit,
// duplicate and copy to…, and delete at the far right. Swiping left or
// right goes to the next or the one before. The dialog opens without
// focusing the caption, so a phone's keyboard doesn't cover the picture.

import { h, privateField } from "./dom.js";
import { MAX_CAPTION } from "./crypto/media.js";
import { swipeStep } from "./visual-order.js";
import { iconButton } from "./dialog-icons.js";

/** The caption box's placeholder, the same for every kind. */
export const CAPTION_PLACEHOLDER = "Visual caption: description of step, notes on position, etc.";

/**
 * Where a visual is among its item's, and moving to or through them
 * (visuals-ui.js).
 * @typedef {{
 *   place: () => { index: number, count: number },
 *   move: (step: -1 | 1) => Promise<void>,
 *   go: (step: -1 | 1) => void,
 * }} Nav
 */

/**
 * @param {{
 *   id: string, noun: string, caption: string | null,
 *   save: (caption: string | null) => Promise<void>, nav: Nav,
 *   tell: (text: string, isError?: boolean) => void,
 * }} options id: the start of the ids (e.g. "plan-pose"); noun: e.g. "Pose";
 *   save: saves a new caption (throws if it can't)
 */
export function viewerParts({ id, noun, caption, save, nav, tell }) {
  let saved = caption ?? "";
  const input = privateField(h("textarea", {
    id: `${id}-caption`, className: "caption-box", maxLength: MAX_CAPTION, rows: 4, placeholder: CAPTION_PLACEHOLDER,
    "aria-label": "Visual caption",
  }));
  input.value = saved;
  // Shown (in the box's corner) once the caption's been changed.
  const saveButton = iconButton("check", { id: `${id}-save-caption`, label: "Save caption", onclick: saveCaption });
  saveButton.classList.add("save-caption");
  saveButton.disabled = true;
  const changed = () => { saveButton.disabled = input.value.trim() === saved; };
  input.addEventListener("input", changed);
  input.addEventListener("change", changed);
  const captionBox = h("div", { className: "caption-wrap" }, input, saveButton);

  const earlier = iconButton("earlier", { id: `${id}-earlier`, label: "Move earlier", onclick: () => moveBy(-1) });
  const later = iconButton("later", { id: `${id}-later`, label: "Move later", onclick: () => moveBy(1) });
  const position = h("p", { className: "hint viewer-position", id: `${id}-position` });

  /**
   * The row of icons: the arrows, then edit, duplicate and copy to… each in
   * its place (empty when this kind hasn't it), and delete at the far right.
   * @param {{ edit?: HTMLButtonElement | null, duplicate?: HTMLButtonElement | null,
   *   copy?: HTMLButtonElement | null, remove: HTMLButtonElement }} buttons
   */
  function toolbar({ edit = null, duplicate = null, copy = null, remove }) {
    const slot = (/** @type {HTMLButtonElement | null} */ button) => button ?? h("span", { className: "tool-slot", "aria-hidden": "true" });
    return h("div", { className: "viewer-tools", role: "toolbar", "aria-label": `${noun} actions` },
      earlier, later, h("span", { className: "tool-divider", "aria-hidden": "true" }),
      slot(edit), slot(duplicate), slot(copy), h("span", { className: "tool-gap" }), remove);
  }

  /**
   * The top row: where it is, and ✕.
   * @param {() => void} close
   */
  function head(close) {
    return h("div", { className: "viewer-head" }, position, iconButton("close", { id: `${id}-close`, label: "Close", onclick: close }));
  }

  async function saveCaption() {
    const text = input.value.trim();
    saveButton.disabled = true;
    try {
      tell("Saving…");
      await save(text || null);
      saved = text;
      tell("Caption saved.");
    } catch (err) {
      saveButton.disabled = false;
      tell("Couldn't save the caption: " + (err instanceof Error ? err.message : String(err)), true);
    }
  }

  /** @param {-1 | 1} step */
  async function moveBy(step) {
    try {
      await nav.move(step);
      refresh();
      tell("");
    } catch (err) {
      tell("Couldn't move it: " + (err instanceof Error ? err.message : String(err)), true);
    }
  }

  /** Shows where it is now (after a move, or another visual added). */
  function refresh() {
    const { index, count } = nav.place();
    position.textContent = `${noun}: ${index + 1} of ${count}`;
    earlier.disabled = index <= 0;
    later.disabled = index >= count - 1;
  }

  /**
   * Sets up the dialog: swiping on it goes to the next or the one before
   * (not from the caption, the buttons or a video's own controls).
   * @param {HTMLDialogElement} dialog
   */
  function attach(dialog) {
    dialog.tabIndex = -1;
    dialog.classList.add("swipeable");
    /** @type {{ x: number, y: number, t: number, pointer: number } | null} */
    let start = null;
    dialog.addEventListener("pointerdown", (event) => {
      const target = /** @type {Element} */ (event.target);
      start = event.isPrimary && !target.closest("input, textarea, select, button, video")
        ? { x: event.clientX, y: event.clientY, t: event.timeStamp, pointer: event.pointerId } : null;
    });
    dialog.addEventListener("pointerup", (event) => {
      if (!start || event.pointerId !== start.pointer) return;
      const step = swipeStep(event.clientX - start.x, event.clientY - start.y, event.timeStamp - start.t);
      start = null;
      const { index, count } = nav.place();
      if (!step || index + step < 0 || index + step >= count) return;
      dialog.close();
      nav.go(step);
    });
    dialog.addEventListener("pointercancel", () => { start = null; });
  }

  /**
   * Opens the dialog, focused on itself: showing a modal dialog focuses
   * its first field otherwise, and a phone would put its keyboard over the
   * picture.
   * @param {HTMLDialogElement} dialog
   */
  function show(dialog) {
    document.body.append(dialog);
    dialog.showModal();
    dialog.focus();
    refresh();
  }

  return { input, captionBox, toolbar, head, position, refresh, attach, show };
}
