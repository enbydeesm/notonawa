// Photos and videos, drawings and poses, and their order, over the journal
// in memory (format 2): the same functions as v1/media.js, drawings.js and
// visuals.js, so the Visuals section doesn't change. A photo or video is a
// format v3 file (sealed in the crypto Worker under a key of its own, which
// goes in its item's record); a drawing or pose is a record of its own,
// listed in its item's visuals (records/visuals.js).
//
// A file is uploaded before the record that lists it is saved, and deleted
// after the record no longer does: either way, a step that fails leaves a
// file no record lists, which cache/orphans.js finds later, never a record
// listing a file that isn't there.

import { api } from "../../api.js";
import { sealFile, openFile, copyFile, reshareFile, adoptShareAsFile } from "../../vault.js";
import { records, record, save } from "./journal.js";
import { newId } from "../../records/ids.js";
import { stamp, BadEdit } from "../../records/parse.js";
import { poseData } from "../../records/pose-data.js";
import {
  itemRef, captionOf, visualAdded, visualRemoved, fileCaptioned, visualsOrdered, mediaRows, drawnRows, findVisual,
} from "../../records/visuals.js";

/** @typedef {import("../../records/visuals.js").Item} Item */
/** @typedef {import("../../photo-prep.js").PreparedPhoto} PreparedPhoto */
/** @typedef {import("../../video-prep.js").PreparedVideo} PreparedVideo */

/**
 * The item's record, as it is now.
 * @param {Item} item
 */
function itemOf(item) {
  const { kind, id } = itemRef(item);
  const entry = record(id);
  if (!entry || entry.kind !== kind) throw new Error("Not found");
  return entry;
}

/** Every tie, plan and workshop: what holds visuals. */
const holders = () => [...records("tie"), ...records("plan"), ...records("workshop")];

/**
 * A visual's item and entry, by its id.
 * @param {string} id
 */
function located(id) {
  const found = findVisual(holders(), id);
  if (!found) throw new Error("Not found");
  return found;
}

/**
 * Uploads a sealed file (PUT /api/files/:id) and lists it last on its item.
 * @param {{ item: Item, id: string, kind: "photo" | "video", mime: string, key: string, body: ArrayBuffer, thumbBytes: number,
 *   caption: string | null }} file
 */
async function addFile({ item, id, kind, mime, key, body, thumbBytes, caption }) {
  itemOf(item);
  // Read before the upload: its size, for the Share dialog's estimate.
  const bytes = body.byteLength;
  const query = new URLSearchParams({ kind, thumb_bytes: String(thumbBytes) });
  await api(`/api/files/${encodeURIComponent(id)}?${query}`, { method: "PUT", body });
  const now = stamp();
  /** @type {import("../../records/visuals.js").Visual} */
  const visual = { kind: "file", id, key, file_kind: kind, mime, bytes, created_at: now, ...(caption ? { caption } : {}) };
  // The item as it is after the upload, which can take a while.
  await save({ writes: [visualAdded(itemOf(item), visual, now)] });
}

/**
 * @param {{ item: Item, prepared: PreparedPhoto | PreparedVideo, caption?: string | null, id?: string }} photo
 *   prepared's buffers are handed to the crypto Worker, so they're emptied
 * @returns {Promise<string>} the photo's id
 */
export async function uploadPhoto({ item, prepared, caption = null, id = newId() }) {
  // Checked first, so a caption that's too long stops the upload.
  const text = captionOf(caption);
  itemOf(item);
  const video = "kind" in prepared && prepared.kind === "video";
  const sealed = await sealFile(id, prepared.thumb, prepared.full);
  await addFile({ item, id, kind: video ? "video" : "photo", mime: prepared.mime, caption: text, ...sealed });
  return id;
}

/**
 * Format 1's upload of a photo already sealed as mine: format 2 adds a
 * share's photos with adoptSharedMedia instead.
 * @param {any} _photo
 */
export async function uploadSealed(_photo) {
  throw new Error("Reload the app to add this.");
}

/**
 * One of my photos or videos sealed again for a share with its link's key
 * (in the crypto Worker, with the key from its item's record), as the
 * object to upload to the share.
 * @param {{ shareId: string, linkKey: string, file: { file: string, mediaId: string, kind: "photo" | "video" } }} args
 * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
 */
export async function shareFileObject({ shareId, linkKey, file }) {
  const { visual } = located(file.mediaId);
  return reshareFile({ shareId, key: linkKey, fileId: file.file, sourceId: file.mediaId, sourceKey: visual.key, kind: file.kind });
}

/**
 * A share's photo or video added to one of my items: opened with its
 * link's key and sealed as a v3 file of mine in the crypto Worker,
 * uploaded, then listed last on the item.
 * @param {{ target: Item, shareId: string, linkKey: string,
 *   visual: { file: string, kind: "photo" | "video", mime: string, caption: string | null } }} args
 */
export async function adoptSharedMedia({ target, shareId, linkKey, visual }) {
  itemOf(target);
  const id = newId();
  const sealed = await adoptShareAsFile({ shareId, key: linkKey, fileId: visual.file, kind: visual.kind, newFileId: id });
  await addFile({ item: target, id, kind: visual.kind, mime: visual.mime, caption: captionOf(visual.caption), ...sealed });
}

/**
 * An item's photos and videos, in their place among its visuals.
 * @param {Item} item
 */
export async function listMedia(item) {
  return mediaRows(itemOf(item));
}

/**
 * @param {string} id
 * @param {string | null} caption
 */
export async function setMediaCaption(id, caption) {
  const { item } = located(id);
  await save({ writes: [fileCaptioned(item, id, captionOf(caption), stamp())] });
}

/**
 * Takes a photo or video off its item, then deletes its file.
 * @param {string} id
 */
export async function deleteMedia(id) {
  const { item } = located(id);
  await save({ writes: [visualRemoved(item, id, stamp())] });
  // If this fails, the file is an orphan the device deletes later.
  await api("/api/files/delete", { method: "POST", body: { ids: [id] } }).catch(() => {});
}

/**
 * One part of a saved photo or video, opened (the Worker fetches it).
 * Throws CantOpen if it won't open.
 * @param {{ id: string }} photo
 * @param {"thumb" | "full"} part
 * @returns {Promise<ArrayBuffer>}
 */
export async function openMediaPart(photo, part) {
  const { visual } = located(photo.id);
  return openFile({ fileId: photo.id, key: visual.key, part });
}

/**
 * A copy of a saved photo or video on another item: a new file under its
 * own key (opened and sealed again in the crypto Worker).
 * @param {{ id: string, kind: "photo" | "video", mime: string, caption: string | null }} photo
 * @param {Item} to
 * @returns {Promise<string>} the copy's id
 */
export async function copyMediaTo(photo, to) {
  const { visual } = located(photo.id);
  itemOf(to);
  const id = newId();
  const sealed = await copyFile({ fileId: photo.id, key: visual.key, newFileId: id });
  await addFile({ item: to, id, kind: photo.kind, mime: photo.mime, caption: captionOf(photo.caption), ...sealed });
  return id;
}

/**
 * The functions for drawings or poses.
 * @param {"drawing" | "pose"} kind
 */
function drawn(kind) {
  /** @param {string} id */
  const own = (id) => {
    const entry = record(id);
    if (!entry || entry.kind !== kind) throw new Error("Not found");
    return entry;
  };
  return {
    /** @param {Item} item */
    list: async (item) => drawnRows(itemOf(item), kind, (id) => record(id)),
    /**
     * Adds one, last among the item's visuals, in one save with the item.
     * @param {Item} item
     * @param {{ data: any, caption: string | null }} entry
     * @returns {Promise<string>}
     */
    add: async (item, { data: given, caption }) => {
      const data = kind === "pose" ? poseData(given) : given;
      const id = newId();
      const now = stamp();
      const text = captionOf(caption);
      await save({ writes: [
        { kind, id, body: { data, ...(text ? { caption: text } : {}), created_at: now, updated_at: now } },
        visualAdded(itemOf(item), { kind, id }, now),
      ] });
      return id;
    },
    /**
     * New lines or numbers, or a new caption.
     * @param {string} id
     * @param {{ data: any } | { caption: string | null }} change
     */
    update: async (id, change) => {
      const entry = own(id);
      const body = /** @type {Record<string, any>} */ ({ ...entry.body, updated_at: stamp() });
      if ("data" in change) body.data = kind === "pose" ? poseData(change.data) : change.data;
      if ("caption" in change) {
        const text = captionOf(change.caption);
        if (text) body.caption = text;
        else delete body.caption;
      }
      await save({ writes: [{ kind, id, body, from: entry.body ?? undefined }] });
    },
    /**
     * Deletes one, taking it off its item in the same save.
     * @param {string} id
     */
    remove: async (id) => {
      own(id);
      const found = findVisual(holders(), id);
      await save({ writes: found ? [visualRemoved(found.item, id, stamp())] : [], deletes: [{ kind, id }] });
    },
  };
}

const drawings = drawn("drawing");
const poses = drawn("pose");

export const listDrawings = drawings.list;
export const addDrawing = drawings.add;
export const updateDrawing = drawings.update;
export const deleteDrawing = drawings.remove;
export const listPoses = poses.list;
export const addPose = poses.add;
export const updatePose = poses.update;
export const deletePose = poses.remove;

/**
 * Puts an item's visuals in this order: every one listed, or it's refused.
 * @param {Item} item
 * @param {{ kind: "media" | "drawing" | "pose", id: string }[]} order
 */
export async function setVisualOrder(item, order) {
  if (!Array.isArray(order)) throw new BadEdit("Send the order as a list.");
  await save({ writes: [visualsOrdered(itemOf(item), order, stamp())] });
}
