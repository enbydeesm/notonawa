// Poses in a form's Visuals section (visuals-ui.js, which holds the grid
// and the order): adding one with the poser (pose-editor.js), pictures of
// them for their tiles, and the viewer: a bigger picture, Edit, its
// caption, moving it earlier or later, Duplicate, Copy to… another tie,
// plan or workshop, and deleting it. The poser's "Add to visuals" puts a
// picture of the pose into the item's visuals, sealed like any photo.
//
// A pose is kept as numbers (pose-format.js), not encrypted; its caption
// is, sealed here like notes. The pictures are drawn on this device from
// those numbers (pose-scene.js), so the 3D code is only fetched once a
// form has poses to show, or one is added.
//
// On something already saved, each change is saved as it's made. On a new
// tie, plan or workshop, the poses wait in the form and are saved once it
// is, as they need its id.

import { errorMessage } from "./api.js";
import { h, showMessage } from "./dom.js";
import { choose } from "./dialog.js";
import { listPoses, addPose, updatePose, deletePose } from "./store/index.js";
import { MAX_POSES } from "./pose-format.js";
import { jointsInRange } from "./figure-rig.js";
import { chooseCopyTarget } from "./drawing-copy.js";
import { viewerParts } from "./visual-viewer.js";
import { iconButton } from "./dialog-icons.js";

/** @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item */
/** @typedef {import("./pose-format.js").Pose} Pose */

/**
 * A pose in the section: saved (with the server's id) or waiting for its
 * item to be saved (id null). url: its picture, once drawn.
 * @typedef {{
 *   id: string | null, data: Pose, caption: string | null, unreadable?: boolean, url?: string,
 *   position?: number, created_at?: string,
 * }} Entry
 */

/** A thumbnail's size, 3:4 like a photo's. */
const THUMB = { width: 300, height: 400, type: "image/jpeg", quality: 0.85 };
/** The viewer's picture (the poser's "Add to visuals" picture is the same size). */
const FULL = { width: 900, height: 1200, type: "image/png" };

/**
 * Saves a new pose on an item, its caption sealed first.
 * @param {Item} item
 * @param {{ data: Pose, caption: string | null }} pose
 * @returns {Promise<string>} its id
 */
export async function savePose(item, { data, caption }) {
  // A pose saved when the joints went further (Duplicate, Copy to…) is
  // brought within today's ranges first, as the server refuses one past them.
  return addPose(item, { data: jointsInRange(data), caption });
}

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
 * Poses, for the Visuals section.
 * @param {import("./visuals-ui.js").VisualContext} ctx
 */
export function poseKind(ctx) {
  const { idPrefix } = ctx;
  /** @type {Entry[]} */
  let poses = [];

  /**
   * @param {Item} item
   * @returns {Promise<Entry[]>}
   */
  async function load(item) {
    const opened = await listPoses(item);
    poses = opened.map((d) => ({
      id: d.id, data: d.data, caption: d.caption, unreadable: !!d.unreadable?.length, position: d.position, created_at: d.created_at,
    }));
    return poses;
  }

  /** Whether pictures are being drawn (only one run at a time). */
  let drawingPictures = false;

  /** Draws each pose's picture that isn't drawn yet, one at a time. */
  async function drawPictures() {
    if (drawingPictures) return;
    drawingPictures = true;
    try {
      for (let entry = poses.find((d) => !d.url); entry && !ctx.closed(); entry = poses.find((d) => !d.url)) {
        const data = entry.data;
        const blob = await picture(data, THUMB);
        if (ctx.closed()) return;
        if (!blob) {
          ctx.say("This browser can't show 3D, so poses can't be shown or edited here.", true);
          return;
        }
        // Kept only if the pose is still there and wasn't changed meanwhile.
        if (poses.includes(entry) && entry.data === data && !entry.url) entry.url = URL.createObjectURL(blob);
        else if (!poses.includes(entry)) continue;
        ctx.draw();
      }
    } catch (err) {
      ctx.say("Couldn't show a pose: " + errorMessage(err), true);
    } finally {
      drawingPictures = false;
    }
  }

  /** @param {Entry} d */
  function look(d) {
    if (!d.url) queueMicrotask(drawPictures);
    return {
      icon: /** @type {const} */ ("pose"), noun: "Pose",
      thumb: d.url ? h("img", { className: "pose-thumb", src: d.url, alt: "" }) : h("span", { className: "pose-pending", "aria-hidden": "true" }, "Pose"),
      caption: d.caption, unreadable: !!d.unreadable,
    };
  }

  /** @param {Entry} entry its picture's out of date */
  function forgetPicture(entry) {
    if (entry.url) URL.revokeObjectURL(entry.url);
    delete entry.url;
  }

  /**
   * Adds a pose last: saved now if the item is, otherwise waiting.
   * @param {Pose} data
   * @param {string | null} caption
   */
  async function append(data, caption) {
    /** @type {Entry} */
    const entry = { id: null, data, caption };
    const item = ctx.item();
    if (item) entry.id = await savePose(item, entry);
    poses.push(entry);
    ctx.append("pose", entry);
  }

  /**
   * "Add to visuals" in the poser: its picture of the pose (with any pencil
   * marks on it), added last as a photo.
   * @param {Blob} blob a PNG
   */
  async function addPicture(blob) {
    const problems = await ctx.addPhotos([new File([blob], "Pose.png", { type: "image/png" })]);
    if (problems.length) throw new Error(problems.join(" "));
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
        ctx.say("This browser can't show 3D, so poses can't be made here. Try the latest Chrome or Safari.", true);
        return null;
      }
      const { editPose } = await import("./pose-editor.js");
      return await editPose(start, { addToVisuals: addPicture });
    } catch (err) {
      ctx.say("Couldn't open the poser: " + errorMessage(err), true);
      return null;
    }
  }

  async function add() {
    const data = await poser(null);
    if (!data) return;
    await ctx.busy(async () => {
      try {
        ctx.say(ctx.item() ? "Saving the pose…" : "");
        await append(data, null);
        ctx.say("");
      } catch (err) {
        ctx.say("Couldn't save the pose: " + errorMessage(err), true);
      }
    });
  }

  /** @param {Entry} entry */
  function view(entry) {
    /** The viewer's own picture, revoked when it closes. @type {string | null} */
    let fullUrl = null;
    const message = h("p", { className: "message", id: `${idPrefix}-pose-viewer-message`, "aria-live": "polite" });
    /** @param {string} text @param {boolean} [isError] */
    const tell = (text, isError = false) => showMessage(message, text, isError);
    const image = h("img", { className: "pose-full", alt: "The pose", src: entry.url ?? "" });
    const parts = viewerParts({
      id: `${idPrefix}-pose`, noun: "Pose", caption: entry.caption,
      nav: ctx.nav(entry), tell,
      save: async (text) => {
        if (entry.id) {
          await updatePose(entry.id, { caption: text });
        }
        entry.caption = text;
        entry.unreadable = false;
        ctx.draw();
      },
    });
    const duplicateButton = iconButton("duplicate", { id: `${idPrefix}-pose-duplicate`, label: "Duplicate", onclick: duplicate });
    const editButton = iconButton("rename", { id: `${idPrefix}-pose-edit`, label: "Edit pose", onclick: edit });
    editButton.classList.add("accent");

    const dialog = h("dialog", { className: "form-dialog photo-viewer", "aria-label": "Pose" },
      parts.head(() => dialog.close()),
      h("div", { className: "pose-full-frame" }, image),
      parts.captionBox,
      parts.toolbar({
        edit: editButton,
        duplicate: duplicateButton,
        copy: iconButton("copy", { id: `${idPrefix}-pose-copy`, label: "Copy to…", onclick: copy }),
        remove: iconButton("delete", { id: `${idPrefix}-pose-delete`, label: "Delete pose", onclick: remove }),
      }),
      message);
    parts.attach(dialog);
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

    function refresh() {
      parts.refresh();
      duplicateButton.disabled = poses.length >= MAX_POSES;
    }

    async function edit() {
      const data = await poser(entry.data);
      if (!data) {
        refresh();
        return;
      }
      try {
        if (entry.id) {
          tell("Saving…");
          await updatePose(entry.id, { data });
        }
        entry.data = data;
        forgetPicture(entry);
        ctx.draw();
        refresh();
        await showFull();
        tell("Pose saved.");
      } catch (err) {
        tell("Couldn't save the pose: " + errorMessage(err), true);
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
      const target = await chooseCopyTarget({ exclude: ctx.item(), noun: "pose" });
      if (!target) return;
      try {
        tell("Copying…");
        await savePose(target.item, entry);
        tell(`Copied to "${target.title}".`);
      } catch (err) {
        tell("Couldn't copy it: " + errorMessage(err), true);
      }
    }

    async function remove() {
      const choice = await choose({
        title: "Delete this pose?",
        message: "It'll be gone for good. Copies of it elsewhere, and pictures added from it, are kept.",
        choices: [{ label: "Delete pose", value: "delete", style: "solid-danger" }],
      });
      if (choice !== "delete") return;
      try {
        if (entry.id) await deletePose(entry.id);
        forgetPicture(entry);
        poses = poses.filter((d) => d !== entry);
        ctx.remove(entry);
        dialog.close();
      } catch (err) {
        tell("Couldn't delete: " + errorMessage(err), true);
      }
    }

    parts.show(dialog);
    refresh();
    showFull();
  }

  return {
    load,
    look,
    view,
    add,
    room: () => (poses.length >= MAX_POSES ? `There can be at most ${MAX_POSES} poses.` : null),
    /** @param {Entry} entry */
    waiting: (entry) => !entry.id,
    /** @param {Entry} entry @param {Item} target */
    savePending: async (entry, target) => { entry.id = await savePose(target, entry); },
    forget: forgetPicture,
    /**
     * A pose made in the poser on its own (the nav's button), put on a new
     * tie, plan or workshop: added last, waiting for it to be saved.
     * @param {Pose} data
     */
    adopt: (data) => append(data, null),
  };
}
