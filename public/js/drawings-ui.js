// Drawings in a form's Visuals section (visuals-ui.js, which holds the grid
// and the order): adding one with the drawing pad (drawing-editor.js), its
// tile, and the viewer: the drawing, Edit, its caption, moving it earlier
// or later, Duplicate, Copy to… another tie, plan or workshop, and
// deleting it.
//
// A drawing is kept as its lines (drawing-format.js), not encrypted; its
// caption is, sealed here like notes. Duplicating or copying one adds a new
// drawing with the same lines and caption, which is then edited on its own.
//
// On something already saved, each change is saved as it's made. On a new
// tie, plan or workshop, the drawings wait in the form and are saved once it
// is (savePending), as they need its id. A waiting drawing can still be
// copied elsewhere straight away.

import { errorMessage } from "./api.js";
import { h, showMessage } from "./dom.js";
import { choose } from "./dialog.js";
import { listDrawings, addDrawing, updateDrawing, deleteDrawing } from "./store/index.js";
import { MAX_DRAWINGS } from "./drawing-format.js";
import { drawingSvg } from "./drawing-svg.js";
import { editDrawing } from "./drawing-editor.js";
import { chooseCopyTarget } from "./drawing-copy.js";
import { viewerParts } from "./visual-viewer.js";
import { iconButton } from "./dialog-icons.js";

/** @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item */
/** @typedef {import("./drawing-format.js").Drawing} Drawing */

/**
 * A drawing in the section: saved (with the server's id) or waiting for its
 * item to be saved (id null).
 * @typedef {{
 *   id: string | null, data: Drawing, caption: string | null, unreadable?: boolean, position?: number, created_at?: string,
 * }} Entry
 */

/**
 * Saves a new drawing on an item, its caption sealed first.
 * @param {Item} item
 * @param {{ data: Drawing, caption: string | null }} drawing
 * @returns {Promise<string>} its id
 */
export async function saveDrawing(item, { data, caption }) {
  return addDrawing(item, { data, caption });
}

/**
 * Drawings, for the Visuals section.
 * @param {import("./visuals-ui.js").VisualContext} ctx
 */
export function drawingKind(ctx) {
  const { idPrefix } = ctx;
  /** @type {Entry[]} */
  let drawings = [];

  /**
   * @param {Item} item
   * @returns {Promise<Entry[]>}
   */
  async function load(item) {
    const opened = await listDrawings(item);
    drawings = opened.map((d) => ({
      id: d.id, data: d.data, caption: d.caption, unreadable: !!d.unreadable?.length, position: d.position, created_at: d.created_at,
    }));
    return drawings;
  }

  /** @param {Entry} d */
  const look = (d) => ({
    icon: /** @type {const} */ ("drawing"), noun: "Drawing", thumb: h("span", { className: "drawing-thumb" }, drawingSvg(d.data.strokes)),
    caption: d.caption, unreadable: !!d.unreadable,
  });

  /**
   * Adds a drawing last: saved now if the item is, otherwise waiting.
   * @param {Drawing} data
   * @param {string | null} caption
   */
  async function append(data, caption) {
    /** @type {Entry} */
    const entry = { id: null, data, caption };
    const item = ctx.item();
    if (item) entry.id = await saveDrawing(item, entry);
    drawings.push(entry);
    ctx.append("drawing", entry);
  }

  async function add() {
    const data = await editDrawing(null);
    if (!data) return;
    await ctx.busy(async () => {
      try {
        ctx.say(ctx.item() ? "Saving the drawing…" : "");
        await append(data, null);
        ctx.say("");
      } catch (err) {
        ctx.say("Couldn't save the drawing: " + errorMessage(err), true);
      }
    });
  }

  /** @param {Entry} entry */
  function view(entry) {
    const message = h("p", { className: "message", id: `${idPrefix}-drawing-viewer-message`, "aria-live": "polite" });
    /** @param {string} text @param {boolean} [isError] */
    const tell = (text, isError = false) => showMessage(message, text, isError);
    const picture = h("div", { className: "drawing-full" }, drawingSvg(entry.data.strokes));
    const parts = viewerParts({
      id: `${idPrefix}-drawing`, noun: "Drawing", caption: entry.caption,
      nav: ctx.nav(entry), tell,
      save: async (text) => {
        if (entry.id) {
          await updateDrawing(entry.id, { caption: text });
        }
        entry.caption = text;
        entry.unreadable = false;
        ctx.draw();
      },
    });
    const duplicateButton = iconButton("duplicate", { id: `${idPrefix}-drawing-duplicate`, label: "Duplicate", onclick: duplicate });
    const editButton = iconButton("rename", { id: `${idPrefix}-drawing-edit`, label: "Edit drawing", onclick: edit });
    editButton.classList.add("accent");

    const dialog = h("dialog", { className: "form-dialog photo-viewer", "aria-label": "Drawing" },
      parts.head(() => dialog.close()),
      picture,
      parts.captionBox,
      parts.toolbar({
        edit: editButton,
        duplicate: duplicateButton,
        copy: iconButton("copy", { id: `${idPrefix}-drawing-copy`, label: "Copy to…", onclick: copy }),
        remove: iconButton("delete", { id: `${idPrefix}-drawing-delete`, label: "Delete drawing", onclick: remove }),
      }),
      message);
    parts.attach(dialog);
    dialog.addEventListener("close", () => dialog.remove());

    function refresh() {
      parts.refresh();
      duplicateButton.disabled = drawings.length >= MAX_DRAWINGS;
    }

    async function edit() {
      const data = await editDrawing(entry.data);
      if (!data) return;
      try {
        if (entry.id) {
          tell("Saving…");
          await updateDrawing(entry.id, { data });
        }
        entry.data = data;
        picture.replaceChildren(drawingSvg(data.strokes));
        ctx.draw();
        tell("Drawing saved.");
      } catch (err) {
        tell("Couldn't save the drawing: " + errorMessage(err), true);
      }
    }

    async function duplicate() {
      await ctx.busy(async () => {
        try {
          tell(ctx.item() ? "Duplicating…" : "");
          await append(entry.data, entry.caption);
          refresh();
          tell("Duplicated: the copy is last, and can be edited on its own.");
        } catch (err) {
          tell("Couldn't duplicate it: " + errorMessage(err), true);
        }
      });
    }

    async function copy() {
      const target = await chooseCopyTarget({ exclude: ctx.item() });
      if (!target) return;
      try {
        tell("Copying…");
        await saveDrawing(target.item, entry);
        tell(`Copied to "${target.title}".`);
      } catch (err) {
        tell("Couldn't copy it: " + errorMessage(err), true);
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
        if (entry.id) await deleteDrawing(entry.id);
        drawings = drawings.filter((d) => d !== entry);
        ctx.remove(entry);
        dialog.close();
      } catch (err) {
        tell("Couldn't delete: " + errorMessage(err), true);
      }
    }

    parts.show(dialog);
    refresh();
  }

  return {
    load,
    look,
    view,
    add,
    room: () => (drawings.length >= MAX_DRAWINGS ? `There can be at most ${MAX_DRAWINGS} drawings.` : null),
    /** @param {Entry} entry */
    waiting: (entry) => !entry.id,
    /** @param {Entry} entry @param {Item} target */
    savePending: async (entry, target) => { entry.id = await saveDrawing(target, entry); },
    forget: () => {},
  };
}
