// The Poses section of the tie, plan and workshop forms, under Drawings:
// pictures of the item's poses in a grid, each with its caption, and a +
// that opens the poser (pose-editor.js). Tapping one opens the viewer: a
// bigger picture, its caption, Edit, Duplicate, Copy to… another tie, plan
// or workshop, "Add as photo" (the picture goes into the form's Photos,
// sealed like any photo), moving it earlier or later, and deleting it.
// Poses can also be dragged into order, as drawings can.
//
// A pose is kept as numbers (pose-format.js), not encrypted; its caption
// is, sealed here like notes. The pictures are drawn on this device from
// those numbers (pose-scene.js), so the 3D code is only fetched once a
// form has poses to show, or one is added.
//
// On something already saved, each change is saved as it's made. On a new
// tie, plan or workshop, the poses wait in the form and are saved once it
// is (savePending), as they need its id.

import { api, errorMessage } from "./api.js";
import { h, showMessage, privateField } from "./dom.js";
import { choose } from "./dialog.js";
import { open, sealOne } from "./vault.js";
import { MAX_CAPTION } from "./crypto/media.js";
import { MAX_POSES } from "./pose-format.js";
import { chooseCopyTarget } from "./drawing-copy.js";
import { moveItem } from "./drag-order.js";
import { tileDrag } from "./tile-drag.js";

/** @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item */
/** @typedef {import("./pose-format.js").Pose} Pose */

/**
 * A pose in the section: saved (with the server's id) or waiting for its
 * item to be saved (id null). url: its picture, once drawn.
 * @typedef {{ id: string | null, data: Pose, caption: string | null, unreadable?: boolean, url?: string }} Entry
 */

/** A thumbnail's size, 3:4 like a photo's. */
const THUMB = { width: 300, height: 400, type: "image/jpeg", quality: 0.85 };
/** The viewer's picture, and a photo made from a pose. */
const FULL = { width: 900, height: 1200, type: "image/png" };

/**
 * Saves a new pose on an item, its caption sealed first.
 * @param {Item} item
 * @param {{ data: Pose, caption: string | null }} pose
 * @returns {Promise<string>} its id
 */
export async function savePose(item, { data, caption }) {
  const { caption: sealed } = await sealOne("pose", { caption });
  return (await api("/api/poses", { method: "POST", body: { ...item, data, caption: sealed } })).id;
}

/**
 * "Add as photo" for a form: puts a pose's picture into its Photos section,
 * which prepares and seals it like any photo.
 * @param {{ addFiles: (files: File[]) => Promise<string[]> }} photos the form's Photos section
 * @returns {(file: File) => Promise<void>}
 */
export const intoPhotos = (photos) => async (file) => {
  const problems = await photos.addFiles([file]);
  if (problems.length) throw new Error(problems.join(" "));
};

/** The 3D code, fetched the first time it's needed. */
const scene = () => import("./pose-scene.js");

/**
 * A picture of a pose, or null if this browser can't draw 3D.
 * @param {Pose} pose
 * @param {{ width: number, height: number, type: string, quality?: number }} size
 * @returns {Promise<Blob | null>}
 */
async function picture(pose, size) {
  const { canDraw3d, poseImage } = await scene();
  if (!canDraw3d()) return null;
  return poseImage(pose, size);
}

/**
 * @param {{
 *   item: Item | null, idPrefix: string,
 *   addPhoto?: (file: File) => Promise<void>,
 * }} options item: what's being edited, or null for a new one (poses
 *   wait for savePending); addPhoto: puts a picture into the form's Photos
 */
export function poseSection({ item, idPrefix, addPhoto }) {
  /** @type {Entry[]} */
  let poses = [];
  let busy = 0;
  let closed = false;

  const status = h("p", { className: "message", id: `${idPrefix}-poses-message`, "aria-live": "polite" });
  const grid = h("div", { className: "photo-grid", id: `${idPrefix}-poses` });
  const drag = tileDrag(grid, {
    count: () => poses.length,
    onDrop: async (from, to) => {
      try {
        await saveOrder(moveItem(poses, from, to));
        say("");
      } catch (err) {
        say("Couldn't move it: " + errorMessage(err), true);
      }
    },
  });
  const addButton = h("button", {
    type: "button", className: "label-add", id: `${idPrefix}-add-pose`,
    "aria-label": "Add pose", title: "Add pose", onclick: add,
  }, "+");
  const element = h("div", { className: "photo-section pose-section" },
    h("div", { className: "label-row" }, h("label", {}, "Poses"), addButton),
    grid,
    item ? null : h("p", { className: "hint" }, "Poses are saved when you save this form."),
    status);

  /** @param {string} text @param {boolean} [isError] */
  const say = (text, isError = false) => showMessage(status, text, isError);

  async function load() {
    if (!item) return;
    try {
      /** @type {{ id: string, data: Pose, caption: string | null }[]} */
      const listed = await api(`/api/poses?${new URLSearchParams(item)}`);
      const opened = await open("pose", listed);
      poses = opened.map((d) => ({ id: d.id, data: d.data, caption: d.caption, unreadable: !!d.unreadable?.length }));
      draw();
    } catch (err) {
      say("Couldn't load the poses: " + errorMessage(err), true);
    }
  }

  /** Whether pictures are being drawn (only one run at a time). */
  let drawingPictures = false;

  /** Draws each pose's picture that isn't drawn yet, one at a time. */
  async function drawPictures() {
    if (drawingPictures) return;
    drawingPictures = true;
    try {
      for (let entry = poses.find((d) => !d.url); entry && !closed; entry = poses.find((d) => !d.url)) {
        const data = entry.data;
        const blob = await picture(data, THUMB);
        if (closed) return;
        if (!blob) {
          say("This browser can't show 3D, so poses can't be shown or edited here.", true);
          return;
        }
        // Kept only if the pose is still there and wasn't changed meanwhile.
        if (poses.includes(entry) && entry.data === data && !entry.url) entry.url = URL.createObjectURL(blob);
        else if (!poses.includes(entry)) continue;
        draw();
      }
    } catch (err) {
      say("Couldn't show a pose: " + errorMessage(err), true);
    } finally {
      drawingPictures = false;
    }
  }

  function draw() {
    grid.replaceChildren(...poses.map((d, i) => {
      const label = `Pose ${i + 1} of ${poses.length}${d.caption ? `: ${d.caption}` : ""}`;
      return h("figure", { className: "photo-tile" },
        h("button", { type: "button", className: "photo-thumb pose-thumb", "aria-label": label, onclick: () => view(d) },
          d.url ? h("img", { src: d.url, alt: "" }) : h("span", { className: "pose-pending", "aria-hidden": "true" }, `Pose ${i + 1}`)),
        d.caption ? h("figcaption", {}, d.caption)
          : d.unreadable ? h("figcaption", { className: "deleted" }, "(can't decrypt the caption)") : null);
    }));
    addButton.disabled = poses.length >= MAX_POSES;
    if (poses.some((d) => !d.url)) drawPictures();
  }

  /** @param {Entry} entry its picture's out of date */
  function forgetPicture(entry) {
    if (entry.url) URL.revokeObjectURL(entry.url);
    delete entry.url;
  }

  /**
   * Puts the poses in this order, saving it if they're all saved.
   * @param {Entry[]} order
   */
  async function saveOrder(order) {
    if (item && order.every((d) => d.id)) {
      await api("/api/poses/order", { method: "PUT", body: { ...item, ids: order.map((d) => d.id) } });
    }
    poses = order;
    draw();
  }

  /**
   * Adds a pose last: saved now if the item is, otherwise waiting.
   * @param {Pose} data
   * @param {string | null} caption
   */
  async function append(data, caption) {
    /** @type {Entry} */
    const entry = { id: null, data, caption };
    if (item) entry.id = await savePose(item, entry);
    poses.push(entry);
    draw();
  }

  /**
   * Opens the poser, if this browser can draw 3D.
   * @param {Pose | null} start
   * @returns {Promise<Pose | null>}
   */
  async function poser(start) {
    try {
      const { canDraw3d } = await scene();
      if (!canDraw3d()) {
        say("This browser can't show 3D, so poses can't be made here. Try the latest Chrome or Safari.", true);
        return null;
      }
      const { editPose } = await import("./pose-editor.js");
      return await editPose(start);
    } catch (err) {
      say("Couldn't open the poser: " + errorMessage(err), true);
      return null;
    }
  }

  async function add() {
    const data = await poser(null);
    if (!data) return;
    busy++;
    try {
      say(item ? "Saving the pose…" : "");
      await append(data, null);
      say("");
    } catch (err) {
      say("Couldn't save the pose: " + errorMessage(err), true);
    } finally {
      busy--;
    }
  }

  /**
   * After a new item is saved: saves the poses waiting for it, in order.
   * Ones that fail stay waiting, so saving again tries them again.
   * @param {Item} target
   * @returns {Promise<string | null>} what went wrong, or null
   */
  async function savePending(target) {
    item = target;
    const waiting = poses.filter((d) => !d.id);
    for (const [i, entry] of waiting.entries()) {
      say(`Saving pose ${i + 1} of ${waiting.length}…`);
      try {
        entry.id = await savePose(target, entry);
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
    const index = () => poses.indexOf(entry);
    /** The viewer's own picture, revoked when it closes. @type {string | null} */
    let fullUrl = null;
    const message = h("p", { className: "message", id: `${idPrefix}-pose-viewer-message`, "aria-live": "polite" });
    const image = h("img", { className: "pose-full", alt: "The pose", src: entry.url ?? "" });
    const captionInput = privateField(h("input", {
      id: `${idPrefix}-pose-caption`, maxLength: MAX_CAPTION, value: entry.caption ?? "", placeholder: "e.g. Step 2: the hip line",
    }));
    const earlier = h("button", { type: "button", id: `${idPrefix}-pose-earlier`, onclick: () => move(-1) }, "Move earlier");
    const later = h("button", { type: "button", id: `${idPrefix}-pose-later`, onclick: () => move(1) }, "Move later");
    const duplicateButton = h("button", { type: "button", id: `${idPrefix}-pose-duplicate`, onclick: duplicate }, "Duplicate");
    const photoButton = addPhoto
      ? h("button", { type: "button", id: `${idPrefix}-pose-photo`, onclick: toPhoto }, "Add as photo") : null;
    const position = h("p", { className: "hint" });

    const dialog = h("dialog", { className: "form-dialog photo-viewer", "aria-label": "Pose" },
      h("div", { className: "pose-full-frame" }, image),
      position,
      h("label", { htmlFor: `${idPrefix}-pose-caption` }, "Caption"),
      captionInput,
      h("div", { className: "dialog-buttons" },
        h("button", { type: "button", id: `${idPrefix}-pose-save-caption`, onclick: saveCaption }, "Save caption"),
        h("button", { type: "button", id: `${idPrefix}-pose-edit`, onclick: edit }, "Edit pose"),
        photoButton,
        duplicateButton,
        h("button", { type: "button", id: `${idPrefix}-pose-copy`, onclick: copy }, "Copy to…"),
        earlier, later),
      h("button", { type: "button", className: "dialog-cancel", onclick: () => dialog.close() }, "Close"),
      h("button", { type: "button", className: "danger dialog-delete", id: `${idPrefix}-pose-delete`, onclick: remove }, "Delete pose"),
      message);
    dialog.addEventListener("close", () => {
      if (fullUrl) URL.revokeObjectURL(fullUrl);
      dialog.remove();
    });

    /** Draws the big picture (the thumbnail shows until it's ready). */
    async function showFull() {
      try {
        const blob = await picture(entry.data, FULL);
        if (!blob || !dialog.open) return;
        if (fullUrl) URL.revokeObjectURL(fullUrl);
        fullUrl = URL.createObjectURL(blob);
        image.src = fullUrl;
      } catch (err) {
        tell("Couldn't show the pose: " + errorMessage(err), true);
      }
    }

    function showPosition() {
      position.textContent = `Pose ${index() + 1} of ${poses.length}`;
      earlier.disabled = index() <= 0;
      later.disabled = index() >= poses.length - 1;
      duplicateButton.disabled = poses.length >= MAX_POSES;
    }

    /** @param {string} text @param {boolean} [isError] */
    const tell = (text, isError = false) => showMessage(message, text, isError);

    async function saveCaption() {
      const text = captionInput.value.trim() || null;
      try {
        if (entry.id) {
          tell("Saving…");
          const { caption } = await sealOne("pose", { caption: text });
          await api(`/api/poses/${entry.id}`, { method: "PUT", body: { caption } });
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
      const data = await poser(entry.data);
      if (!data) return;
      try {
        if (entry.id) {
          tell("Saving…");
          await api(`/api/poses/${entry.id}`, { method: "PUT", body: { data } });
        }
        entry.data = data;
        forgetPicture(entry);
        draw();
        await showFull();
        tell("Pose saved.");
      } catch (err) {
        tell("Couldn't save the pose: " + errorMessage(err), true);
      }
    }

    async function toPhoto() {
      if (!addPhoto) return;
      try {
        tell("Adding the photo…");
        const blob = await picture(entry.data, FULL);
        if (!blob) throw new Error("This browser can't draw the pose.");
        const name = `${(entry.caption ?? `Pose ${index() + 1}`).replace(/[^\w .-]+/g, "").trim() || "Pose"}.png`;
        await addPhoto(new File([blob], name, { type: "image/png" }));
        tell("Added to Photos and videos, above.");
      } catch (err) {
        tell("Couldn't add the photo: " + errorMessage(err), true);
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
      const target = await chooseCopyTarget({ exclude: item, noun: "pose" });
      if (!target) return;
      try {
        tell("Copying…");
        await savePose(target.item, entry);
        tell(`Copied to "${target.title}".`);
      } catch (err) {
        tell("Couldn't copy it: " + errorMessage(err), true);
      }
    }

    /** @param {number} step -1 earlier, 1 later */
    async function move(step) {
      const from = index();
      const to = from + step;
      if (to < 0 || to >= poses.length) return;
      try {
        await saveOrder(moveItem(poses, from, to));
        showPosition();
        tell("");
      } catch (err) {
        tell("Couldn't move it: " + errorMessage(err), true);
      }
    }

    async function remove() {
      const choice = await choose({
        title: "Delete this pose?",
        message: "It'll be gone for good. Copies of it elsewhere, and photos made from it, are kept.",
        choices: [{ label: "Delete pose", value: "delete", style: "solid-danger" }],
      });
      if (choice !== "delete") return;
      try {
        if (entry.id) await api(`/api/poses/${entry.id}`, { method: "DELETE" });
        forgetPicture(entry);
        poses = poses.filter((d) => d !== entry);
        draw();
        dialog.close();
      } catch (err) {
        tell("Couldn't delete: " + errorMessage(err), true);
      }
    }

    document.body.append(dialog);
    dialog.showModal();
    showPosition();
    showFull();
  }

  /** Lets go of the section (when its form closes). */
  function close() {
    closed = true;
    drag.stop();
    for (const entry of poses) forgetPicture(entry);
    poses = [];
  }

  load();
  return {
    element,
    savePending,
    close,
    /** Whether a pose is being saved. */
    get busy() { return busy > 0; },
    /** Whether any poses are waiting for the item to be saved. */
    get waiting() { return poses.some((d) => !d.id); },
  };
}
