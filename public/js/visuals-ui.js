// The Visuals section of the tie, plan and workshop forms: an item's photos
// and videos, drawings and poses in one grid, in the one order they share,
// however they're arranged. Each tile is outlined in its kind's color (the
// key is beside the label). + opens "Add a visual from…": a photo or video,
// a drawing (the drawing pad), or a pose (the model poser). Tapping a tile
// opens its details; swiping there goes to the next or the one before.
// Tiles can be dragged into order, with a mouse or (after holding still a
// moment, so a swipe still scrolls) a finger.
//
// What's particular to each kind is in its own module: photos-ui.js,
// drawings-ui.js and poses-ui.js. This one holds the list and its order.
//
// On something already saved, each change is saved as it's made. On a new
// tie, plan or workshop, the visuals wait in the form and are saved, in
// order, once it is (savePending), as they need its id.

import { api, errorMessage } from "./api.js";
import { h, showMessage } from "./dom.js";
import { moveItem } from "./drag-order.js";
import { tileDrag } from "./tile-drag.js";
import { mergeVisuals, orderBody } from "./visual-order.js";
import { ICONS } from "./visual-icons.js";
import { photoKind } from "./photos-ui.js";
import { drawingKind } from "./drawings-ui.js";
import { poseKind } from "./poses-ui.js";

/** @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item */
/** @typedef {import("./visual-order.js").VisualKind} VisualKind */
/** @typedef {import("./visual-viewer.js").Nav} Nav */
/** @typedef {import("./visual-icons.js").IconKind} IconKind */

/**
 * What the section gives each kind's module.
 * @typedef {{
 *   item: () => Item | null, idPrefix: string,
 *   say: (text: string, isError?: boolean) => void,
 *   draw: () => void,
 *   append: (kind: VisualKind, ref: any) => void,
 *   remove: (ref: any) => void,
 *   nav: (ref: any) => Nav,
 *   busy: <T>(work: () => Promise<T>) => Promise<T>,
 *   addPhotos: (files: File[]) => Promise<string[]>,
 *   closed: () => boolean,
 * }} VisualContext
 */

/**
 * What each kind's module gives the section.
 * @typedef {{
 *   load: (item: Item) => Promise<any[]>,
 *   look: (ref: any) => { icon: IconKind, noun: string, thumb: Node, caption: string | null, unreadable: boolean },
 *   view: (ref: any) => void,
 *   add: () => void,
 *   room: () => string | null,
 *   waiting: (ref: any) => boolean,
 *   savePending: (ref: any, item: Item) => Promise<void>,
 *   forget: (ref: any) => void,
 *   extra?: Node,
 * }} VisualKindModule
 */

/** The chooser's options and the color key, in order. */
const CHOICES = /** @type {const} */ ([["media", "photo", "Photo/video"], ["drawing", "drawing", "Drawing"], ["pose", "pose", "Model poser"]]);
/** The color key: each kind's icon and the words for it. */
const KEY = /** @type {const} */ ([["photo", "Photo", "teal"], ["video", "Video", "purple"], ["drawing", "Drawing", "coral"], ["pose", "Pose", "yellow"]]);

/**
 * @param {{ item: Item | null, idPrefix: string }} options item: what's
 *   being edited, or null for a new one (visuals wait for savePending)
 */
export function visualSection({ item, idPrefix }) {
  /** Every visual, first to last. @type {{ kind: VisualKind, ref: any }[]} */
  let visuals = [];
  let busyCount = 0;
  let closed = false;

  const status = h("p", { className: "message", id: `${idPrefix}-visuals-message`, "aria-live": "polite" });
  const grid = h("div", { className: "photo-grid", id: `${idPrefix}-visuals` });
  const drag = tileDrag(grid, {
    count: () => visuals.length,
    onDrop: async (from, to) => {
      try {
        await saveOrder(moveItem(visuals, from, to));
        say("");
      } catch (err) {
        say("Couldn't move it: " + errorMessage(err), true);
      }
    },
  });

  /** @param {string} text @param {boolean} [isError] */
  const say = (text, isError = false) => showMessage(status, text, isError);

  /** @type {VisualContext} */
  const ctx = {
    item: () => item,
    idPrefix,
    say,
    draw,
    append: (kind, ref) => {
      visuals.push({ kind, ref });
      draw();
    },
    remove: (ref) => {
      visuals = visuals.filter((v) => v.ref !== ref);
      draw();
    },
    nav: (ref) => ({
      place: () => ({ index: visuals.findIndex((v) => v.ref === ref), count: visuals.length }),
      move: async (step) => {
        const from = visuals.findIndex((v) => v.ref === ref);
        const to = from + step;
        if (from >= 0 && to >= 0 && to < visuals.length) await saveOrder(moveItem(visuals, from, to));
      },
      go: (step) => {
        const next = visuals[visuals.findIndex((v) => v.ref === ref) + step];
        if (next) kinds[next.kind].view(next.ref);
      },
    }),
    busy: async (work) => {
      busyCount++;
      try {
        return await work();
      } finally {
        busyCount--;
      }
    },
    addPhotos: (files) => photos.addFiles(files),
    closed: () => closed,
  };

  const photos = photoKind(ctx);
  /** @type {Record<VisualKind, VisualKindModule>} */
  const kinds = { media: photos, drawing: drawingKind(ctx), pose: poseKind(ctx) };

  const addButton = h("button", {
    type: "button", className: "label-add", id: `${idPrefix}-add-visual`, "aria-label": "Add visual", title: "Add visual", onclick: choose,
  }, "+");
  const key = h("div", {
    className: "visual-key", role: "img",
    "aria-label": `Outline colors: ${KEY.map(([, name, color]) => `${color} ${name.toLowerCase()}`).join(", ")}`,
  }, KEY.map(([icon, name, color]) => h("span", { className: `visual-key-item c-${color}`, title: name }, ICONS[icon]())));
  const element = h("div", { className: "photo-section visual-section" },
    h("div", { className: "label-row" }, h("label", {}, "Visuals"), addButton, key),
    photos.extra ?? null,
    grid,
    h("p", { className: "hint" }, item
      ? "Drag visuals into order and caption them to describe a sequence."
      : "Drag visuals into order and caption them to describe a sequence. They're saved when you save this form."),
    status);

  async function load() {
    if (!item) return;
    say("Loading the visuals…");
    try {
      const [media, drawing, pose] = await Promise.all([kinds.media.load(item), kinds.drawing.load(item), kinds.pose.load(item)]);
      if (closed) return;
      visuals = mergeVisuals({ media, drawing, pose }).map(({ kind, item: ref }) => ({ kind, ref }));
      draw();
      say("");
    } catch (err) {
      say("Couldn't load the visuals: " + errorMessage(err), true);
    }
  }

  function draw() {
    grid.replaceChildren(...visuals.map(({ kind, ref }, i) => {
      const look = kinds[kind].look(ref);
      const label = `${look.noun} ${i + 1} of ${visuals.length}${look.caption ? `: ${look.caption}` : ""}`;
      return h("figure", { className: `photo-tile visual-${look.icon}` },
        h("button", { type: "button", className: "photo-thumb", "aria-label": label, onclick: () => kinds[kind].view(ref) },
          look.thumb,
          look.icon === "video" ? h("span", { className: "video-badge", "aria-hidden": "true" }, "▶") : null),
        look.caption ? h("figcaption", {}, look.caption)
          : look.unreadable ? h("figcaption", { className: "deleted" }, "(can't decrypt the caption)") : null);
    }));
    addButton.disabled = CHOICES.every(([kind]) => kinds[kind].room() !== null);
  }

  /**
   * Puts the visuals in this order, saving it if they're all saved
   * (waiting ones are only in this form until it's saved).
   * @param {{ kind: VisualKind, ref: any }[]} order
   */
  async function saveOrder(order) {
    if (item && order.length > 0 && !order.some((v) => kinds[v.kind].waiting(v.ref))) {
      await api("/api/visuals/order", { method: "PUT", body: { ...item, order: orderBody(order.map((v) => ({ kind: v.kind, id: v.ref.id }))) } });
    }
    visuals = order;
    draw();
  }

  /** "Add a visual from…": a photo or video, a drawing or a pose. */
  function choose() {
    const dialog = h("dialog", { className: "form-dialog visual-chooser", "aria-labelledby": `${idPrefix}-chooser-title` },
      h("h2", { id: `${idPrefix}-chooser-title` }, "Add a visual from…"),
      h("div", { className: "visual-choices" }, CHOICES.map(([kind, icon, label]) => {
        const full = kinds[kind].room();
        return h("button", {
          type: "button", className: "visual-choice", id: `${idPrefix}-add-${kind}`, disabled: full !== null, title: full ?? label,
          // Straight from the tap, so the browser lets a file picker open.
          onclick: () => {
            dialog.close();
            kinds[kind].add();
          },
        }, ICONS[icon](), h("span", {}, label));
      })),
      h("button", { type: "button", className: "dialog-cancel", onclick: () => dialog.close() }, "Cancel"));
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  /**
   * After a new item is saved: saves the visuals waiting for it, in order.
   * Ones that fail stay waiting, so saving again tries them again.
   * @param {Item} target
   * @returns {Promise<string | null>} what went wrong, or null
   */
  async function savePending(target) {
    item = target;
    const waiting = visuals.filter((v) => kinds[v.kind].waiting(v.ref));
    for (const [i, { kind, ref }] of waiting.entries()) {
      say(`Saving visual ${i + 1} of ${waiting.length}…`);
      try {
        await kinds[kind].savePending(ref, target);
      } catch (err) {
        say("");
        return errorMessage(err);
      }
    }
    say("");
    draw();
    return null;
  }

  /** Lets go of everything the section showed (when its form closes). */
  function close() {
    closed = true;
    drag.stop();
    for (const { kind, ref } of visuals) kinds[kind].forget(ref);
    visuals = [];
  }

  load();
  return {
    element,
    savePending,
    close,
    /** Whether visuals are still being prepared or saved. */
    get busy() { return busyCount > 0; },
    /** Whether any visuals are waiting for the item to be saved. */
    get waiting() { return visuals.some((v) => kinds[v.kind].waiting(v.ref)); },
  };
}
