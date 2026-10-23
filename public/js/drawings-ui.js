// The Drawings section of the tie, plan and workshop forms, under Photos and
// videos: thumbnails in a grid, each with its caption, and a + that opens
// the drawing pad (drawing-editor.js). Tapping one opens the viewer: the
// drawing, its caption, Edit, Duplicate, Copy to… another tie, plan or
// workshop, moving it earlier or later, and deleting it. Drawings can also
// be dragged into order, as photos can.
//
// A drawing is kept as its lines (drawing-format.js), not encrypted; its
// caption is, sealed here like notes. Duplicating or copying one adds a new
// drawing with the same lines and caption, which is then edited on its own.
//
// On something already saved, each change is saved as it's made. On a new
// tie, plan or workshop, the drawings wait in the form and are saved once it
// is (savePending), as they need its id. A waiting drawing can still be
// copied elsewhere straight away.

import { api, errorMessage } from "./api.js";
import { h, showMessage, privateField } from "./dom.js";
import { choose } from "./dialog.js";
import { open, sealOne } from "./vault.js";
import { MAX_CAPTION } from "./crypto/media.js";
import { MAX_DRAWINGS } from "./drawing-format.js";
import { drawingSvg } from "./drawing-svg.js";
import { editDrawing } from "./drawing-editor.js";
import { chooseCopyTarget } from "./drawing-copy.js";
import { moveItem } from "./drag-order.js";
import { tileDrag } from "./tile-drag.js";

/** @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item */
/** @typedef {import("./drawing-format.js").Drawing} Drawing */

/**
 * A drawing in the section: saved (with the server's id) or waiting for its
 * item to be saved (id null).
 * @typedef {{ id: string | null, data: Drawing, caption: string | null, unreadable?: boolean }} Entry
 */

/**
 * Saves a new drawing on an item, its caption sealed first.
 * @param {Item} item
 * @param {{ data: Drawing, caption: string | null }} drawing
 * @returns {Promise<string>} its id
 */
export async function saveDrawing(item, { data, caption }) {
  const { caption: sealed } = await sealOne("drawing", { caption });
  return (await api("/api/drawings", { method: "POST", body: { ...item, data, caption: sealed } })).id;
}

/**
 * @param {{ item: Item | null, idPrefix: string }} options item: what's
 *   being edited, or null for a new one (drawings wait for savePending)
 */
export function drawingSection({ item, idPrefix }) {
  /** @type {Entry[]} */
  let drawings = [];
  let busy = 0;

  const status = h("p", { className: "message", id: `${idPrefix}-drawings-message`, "aria-live": "polite" });
  const grid = h("div", { className: "photo-grid", id: `${idPrefix}-drawings` });
  const drag = tileDrag(grid, {
    count: () => drawings.length,
    onDrop: async (from, to) => {
      try {
        await saveOrder(moveItem(drawings, from, to));
        say("");
      } catch (err) {
        say("Couldn't move it: " + errorMessage(err), true);
      }
    },
  });
  const addButton = h("button", {
    type: "button", className: "label-add", id: `${idPrefix}-add-drawing`,
    "aria-label": "Add drawing", title: "Add drawing", onclick: add,
  }, "+");
  const element = h("div", { className: "photo-section drawing-section" },
    h("div", { className: "label-row" }, h("label", {}, "Drawings"), addButton),
    grid,
    item ? null : h("p", { className: "hint" }, "Drawings are saved when you save this form."),
    status);

  /** @param {string} text @param {boolean} [isError] */
  const say = (text, isError = false) => showMessage(status, text, isError);

  async function load() {
    if (!item) return;
    try {
      /** @type {{ id: string, data: Drawing, caption: string | null }[]} */
      const listed = await api(`/api/drawings?${new URLSearchParams(item)}`);
      const opened = await open("drawing", listed);
      drawings = opened.map((d) => ({ id: d.id, data: d.data, caption: d.caption, unreadable: !!d.unreadable?.length }));
      draw();
    } catch (err) {
      say("Couldn't load the drawings: " + errorMessage(err), true);
    }
  }

  function draw() {
    grid.replaceChildren(...drawings.map((d, i) => {
      const label = `Drawing ${i + 1} of ${drawings.length}${d.caption ? `: ${d.caption}` : ""}`;
      return h("figure", { className: "photo-tile" },
        h("button", { type: "button", className: "photo-thumb drawing-thumb", "aria-label": label, onclick: () => view(d) },
          drawingSvg(d.data.strokes)),
        d.caption ? h("figcaption", {}, d.caption)
          : d.unreadable ? h("figcaption", { className: "deleted" }, "(can't decrypt the caption)") : null);
    }));
    addButton.disabled = drawings.length >= MAX_DRAWINGS;
  }

  /**
   * Puts the drawings in this order, saving it if they're all saved.
   * @param {Entry[]} order
   */
  async function saveOrder(order) {
    if (item && order.every((d) => d.id)) {
      await api("/api/drawings/order", { method: "PUT", body: { ...item, ids: order.map((d) => d.id) } });
    }
    drawings = order;
    draw();
  }

  /**
   * Adds a drawing last: saved now if the item is, otherwise waiting.
   * @param {Drawing} data
   * @param {string | null} caption
   */
  async function append(data, caption) {
    /** @type {Entry} */
    const entry = { id: null, data, caption };
    if (item) entry.id = await saveDrawing(item, entry);
    drawings.push(entry);
    draw();
  }

  async function add() {
    const data = await editDrawing(null);
    if (!data) return;
    busy++;
    try {
      say(item ? "Saving the drawing…" : "");
      await append(data, null);
      say("");
    } catch (err) {
      say("Couldn't save the drawing: " + errorMessage(err), true);
    } finally {
      busy--;
    }
  }

  /**
   * After a new item is saved: saves the drawings waiting for it, in order.
   * Ones that fail stay waiting, so saving again tries them again.
   * @param {Item} target
   * @returns {Promise<string | null>} what went wrong, or null
   */
  async function savePending(target) {
    item = target;
    const waiting = drawings.filter((d) => !d.id);
    for (const [i, entry] of waiting.entries()) {
      say(`Saving drawing ${i + 1} of ${waiting.length}…`);
      try {
        entry.id = await saveDrawing(target, entry);
      } catch (err) {
        say("");
        return errorMessage(err);
      }
    }
    say("");
    return null;
  }

  /** @param {Entry} entry */
  function view(entry) {
    const index = () => drawings.indexOf(entry);
    const message = h("p", { className: "message", id: `${idPrefix}-drawing-viewer-message`, "aria-live": "polite" });
    const picture = h("div", { className: "drawing-full" }, drawingSvg(entry.data.strokes));
    const captionInput = privateField(h("input", {
      id: `${idPrefix}-drawing-caption`, maxLength: MAX_CAPTION, value: entry.caption ?? "", placeholder: "e.g. The second wrap",
    }));
    const earlier = h("button", { type: "button", id: `${idPrefix}-drawing-earlier`, onclick: () => move(-1) }, "Move earlier");
    const later = h("button", { type: "button", id: `${idPrefix}-drawing-later`, onclick: () => move(1) }, "Move later");
    const duplicateButton = h("button", { type: "button", id: `${idPrefix}-drawing-duplicate`, onclick: duplicate }, "Duplicate");
    const position = h("p", { className: "hint" });

    const dialog = h("dialog", { className: "form-dialog photo-viewer", "aria-label": "Drawing" },
      picture,
      position,
      h("label", { htmlFor: `${idPrefix}-drawing-caption` }, "Caption"),
      captionInput,
      h("div", { className: "dialog-buttons" },
        h("button", { type: "button", id: `${idPrefix}-drawing-save-caption`, onclick: saveCaption }, "Save caption"),
        h("button", { type: "button", id: `${idPrefix}-drawing-edit`, onclick: edit }, "Edit drawing"),
        duplicateButton,
        h("button", { type: "button", id: `${idPrefix}-drawing-copy`, onclick: copy }, "Copy to…"),
        earlier, later),
      h("button", { type: "button", className: "dialog-cancel", onclick: () => dialog.close() }, "Close"),
      h("button", { type: "button", className: "danger dialog-delete", id: `${idPrefix}-drawing-delete`, onclick: remove }, "Delete drawing"),
      message);
    dialog.addEventListener("close", () => dialog.remove());

    function showPosition() {
      position.textContent = `Drawing ${index() + 1} of ${drawings.length}`;
      earlier.disabled = index() <= 0;
      later.disabled = index() >= drawings.length - 1;
      duplicateButton.disabled = drawings.length >= MAX_DRAWINGS;
    }

    /** @param {string} text @param {boolean} [isError] */
    const tell = (text, isError = false) => showMessage(message, text, isError);

    async function saveCaption() {
      const text = captionInput.value.trim() || null;
      try {
        if (entry.id) {
          tell("Saving…");
          const { caption } = await sealOne("drawing", { caption: text });
          await api(`/api/drawings/${entry.id}`, { method: "PUT", body: { caption } });
        }
        entry.caption = text;
        entry.unreadable = false;
        draw();
        tell("Caption saved.");
      } catch (err) {
        tell("Couldn't save the caption: " + errorMessage(err), true);
      }
    }

    async function edit() {
      const data = await editDrawing(entry.data);
      if (!data) return;
      try {
        if (entry.id) {
          tell("Saving…");
          await api(`/api/drawings/${entry.id}`, { method: "PUT", body: { data } });
        }
        entry.data = data;
        picture.replaceChildren(drawingSvg(data.strokes));
        draw();
        tell("Drawing saved.");
      } catch (err) {
        tell("Couldn't save the drawing: " + errorMessage(err), true);
      }
    }

    async function duplicate() {
      busy++;
      try {
        tell(item ? "Duplicating…" : "");
        await append(entry.data, entry.caption);
        showPosition();
        tell("Duplicated: the copy is last, and can be edited on its own.");
      } catch (err) {
        tell("Couldn't duplicate it: " + errorMessage(err), true);
      } finally {
        busy--;
      }
    }

    async function copy() {
      const target = await chooseCopyTarget({ exclude: item });
      if (!target) return;
      try {
        tell("Copying…");
        await saveDrawing(target.item, entry);
        tell(`Copied to "${target.title}".`);
      } catch (err) {
        tell("Couldn't copy it: " + errorMessage(err), true);
      }
    }

    /** @param {number} step -1 earlier, 1 later */
    async function move(step) {
      const from = index();
      const to = from + step;
      if (to < 0 || to >= drawings.length) return;
      try {
        await saveOrder(moveItem(drawings, from, to));
        showPosition();
        tell("");
      } catch (err) {
        tell("Couldn't move it: " + errorMessage(err), true);
      }
    }

    async function remove() {
      const choice = await choose({
        title: "Delete this drawing?",
        message: "It'll be gone for good. Copies of it elsewhere are kept.",
        choices: [{ label: "Delete drawing", value: "delete", style: "solid-danger" }],
      });
      if (choice !== "delete") return;
      try {
        if (entry.id) await api(`/api/drawings/${entry.id}`, { method: "DELETE" });
        drawings = drawings.filter((d) => d !== entry);
        draw();
        dialog.close();
      } catch (err) {
        tell("Couldn't delete: " + errorMessage(err), true);
      }
    }

    document.body.append(dialog);
    dialog.showModal();
    showPosition();
  }

  /** Lets go of the section (when its form closes). */
  function close() {
    drag.stop();
    drawings = [];
  }

  load();
  return {
    element,
    savePending,
    close,
    /** Whether a drawing is being saved. */
    get busy() { return busy > 0; },
    /** Whether any drawings are waiting for the item to be saved. */
    get waiting() { return drawings.some((d) => !d.id); },
  };
}
