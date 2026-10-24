// What every visual's details dialog shares (a photo's or video's, a
// drawing's, a pose's): where it is in the item's visuals, its caption with
// Save caption beside the label (yellow once the caption's been changed),
// "← Move earlier" and "Move later →", and swiping left or right to the next
// or the one before. The dialog opens without focusing the caption, so a
// phone's keyboard doesn't cover the picture.

import { h, privateField } from "./dom.js";
import { MAX_CAPTION } from "./crypto/media.js";
import { swipeStep } from "./visual-order.js";

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
 *   id: string, noun: string, caption: string | null, placeholder: string,
 *   save: (caption: string | null) => Promise<void>, nav: Nav,
 *   tell: (text: string, isError?: boolean) => void,
 * }} options id: the start of the ids (e.g. "plan-pose"); noun: e.g. "Pose";
 *   save: saves a new caption (throws if it can't)
 */
export function viewerParts({ id, noun, caption, placeholder, save, nav, tell }) {
  let saved = caption ?? "";
  const input = privateField(h("input", { id: `${id}-caption`, maxLength: MAX_CAPTION, value: saved, placeholder }));
  const saveButton = h("button", { type: "button", className: "save-caption", id: `${id}-save-caption`, disabled: true, onclick: saveCaption }, "Save caption");
  const changed = () => { saveButton.disabled = input.value.trim() === saved; };
  input.addEventListener("input", changed);
  input.addEventListener("change", changed);
  const captionRow = h("div", { className: "label-row caption-row" }, h("label", { htmlFor: `${id}-caption` }, "Caption"), saveButton);

  const earlier = h("button", { type: "button", id: `${id}-earlier`, onclick: () => moveBy(-1) }, "← Move earlier");
  const later = h("button", { type: "button", id: `${id}-later`, onclick: () => moveBy(1) }, "Move later →");
  const moveRow = h("div", { className: "dialog-row" }, earlier, later);
  const position = h("p", { className: "hint", id: `${id}-position` });

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

  return { input, captionRow, moveRow, position, refresh, attach, show };
}
