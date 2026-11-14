// "Your data" view: export everything to a file, or import ties (and
// workshops) from an export or a CSV. Files are read here in the browser;
// only the entries in them are sent, in the same way as typing them in
// (see import-steps.js).
// Notes are encrypted: an export opens them on the device before the file
// is saved, and an import seals them before anything is sent.
//
// With photos, an export is a .zip: notonawa.json and a photos/
// folder, each photo and video decrypted here. Importing one saves the
// journal first, then prepares, seals and uploads each photo and video
// (import-photos.js). (Counts in messages call them all photos.)
// Drawings are in notonawa.json as their lines, so a .json export has them
// too; with drawings, the export is a .zip with a picture of each in a
// drawings/ folder (SVG), for looking at outside the app. Importing reads
// the lines, and saves them once the journal is saved (import-drawings.js).
// Poses are in notonawa.json too, as their numbers (no pictures: those take
// the 3D view, which the export doesn't load); importing saves them as it
// does drawings (import-poses.js). Saved poser presets are in the
// account part, names opened; importing adds the ones not already there by
// name (import-presets.js).

import { errorMessage } from "../api.js";
import { h, $, showMessage } from "../dom.js";
import { saveFile } from "../download.js";
import { parseCsv } from "../csv.js";
import { csvToImport } from "../import-csv.js";
import {
  readExport, exportRoleNames, exportDefaultShape, itemsBody, remapTies, remapWorkshops, checkLinks, batches, describeItems, TIE_BATCH,
} from "../import-steps.js";
import { adoptRoleNames, adoptDefaultShape } from "../settings.js";
import { convertJournal, withoutUnreadableMarks } from "../journal-fields.js";
import { duplicateMatches } from "../import-dedupe.js";
import { takePhotos, typeFromName, journalEntry } from "../import-photos.js";
import { takeDrawings } from "../import-drawings.js";
import { saveDrawing } from "../drawings-ui.js";
import { takePoses } from "../import-poses.js";
import { savePose } from "../poses-ui.js";
import { presetsToAdd } from "../import-presets.js";
import { MAX_PRESETS } from "../figure-rig.js";
import { svgFile } from "../drawing-format.js";
import { drawingColors } from "../drawing-svg.js";
import { makeZip, readZip, looksLikeZip } from "../zip.js";
import { preparePhoto } from "../photo-prep.js";
import {
  uploadPhoto, listMedia, setVisualOrder, listPosePresets, addPosePresets, listDrawings, listPoses,
  exportSealed, importItems, importTies, importWorkshops,
} from "../store/index.js";
import { mergeVisuals, orderBody } from "../visual-order.js";
import { askWithoutSound } from "../photos-ui.js";
import { seal, open, openMedia, openPhoto, forgetSearch } from "../vault.js";
import { showSharedByMe, showConnections } from "../shared-by-me.js";
import { linksDroppedText } from "../connection-text.js";

/** @typedef {import("../import-steps.js").ImportDoc} ImportDoc */
/** @typedef {import("../import-photos.js").PhotoEntry} PhotoEntry */
/** @typedef {import("../import-drawings.js").DrawingEntry} DrawingEntry */
/** @typedef {import("../import-poses.js").PoseEntry} PoseEntry */
/**
 * A file to import: as read (notes in plain text, to compare for
 * duplicates) and sealed (as sent), both without their photos, drawings
 * and poses; the photos, drawings and poses listed (ties' by position,
 * plans' by file id); and the zip's files (null for a .json or a CSV).
 * @typedef {{
 *   plain: ImportDoc, sealed: ImportDoc,
 *   photos: ReturnType<typeof takePhotos>, drawings: ReturnType<typeof takeDrawings>,
 *   poses: ReturnType<typeof takePoses>,
 *   files: Map<string, Uint8Array<ArrayBuffer>> | null,
 * }} PendingImport
 */
/**
 * Where an imported tie's, plan's or workshop's photos go. onlyIfEmpty: it
 * was already in the journal (a duplicate tie or workshop, a plan matched
 * by name).
 * @typedef {{
 *   item: { tie_id: string } | { plan_id: string } | { workshop_id: string },
 *   entries: PhotoEntry[], onlyIfEmpty: boolean,
 * }} PhotoTarget
 */
/**
 * Where an imported tie's, plan's or workshop's drawings (or poses) go, as
 * for photos.
 * @template [E=DrawingEntry]
 * @typedef {{ item: PhotoTarget["item"], entries: E[], onlyIfEmpty: boolean }} DrawingTarget
 */

/**
 * The visuals an import added to one tie, plan or workshop, each kind's
 * with its id and its position in the file, so their shared order can be
 * put back once they're all saved.
 * @typedef {{
 *   item: PhotoTarget["item"],
 *   lists: Record<import("../visual-order.js").VisualKind, { id: string, position: number }[]>,
 * }} Placed
 */

/**
 * Which ties of a batch duplicate mine: the server finds candidates (the
 * same but for the notes), and their notes are opened and compared here.
 * Also says which tags are new.
 * @param {any[]} sealedBatch as sent
 * @param {any[]} plainBatch the same ties, notes in plain text
 * @returns {Promise<{ skip: number[], matches: Map<number, string>, newTags: string[] }>}
 */
async function findDuplicates(sealedBatch, plainBatch) {
  const result = await importTies({ preview: true, ties: sealedBatch });
  const candidates = /** @type {{ i: number, id: string, notes: string | null }[]} */ (await open("tie", result.candidates));
  const matches = duplicateMatches(plainBatch, candidates);
  return { skip: [...matches.keys()].sort((a, b) => a - b), matches, newTags: result.new_tags };
}

/**
 * Which workshops of a batch duplicate mine, as findDuplicates does for
 * ties, comparing their description and notes.
 * @param {any[]} sealedBatch as sent
 * @param {any[]} plainBatch the same workshops, in plain text
 * @returns {Promise<{ skip: number[], matches: Map<number, string>, newTags: string[] }>}
 */
async function findWorkshopDuplicates(sealedBatch, plainBatch) {
  const result = await importWorkshops({ preview: true, workshops: sealedBatch });
  const candidates = /** @type {any[]} */ (await open("workshop", result.candidates));
  const matches = duplicateMatches(plainBatch, candidates, ["description", "notes"]);
  return { skip: [...matches.keys()].sort((a, b) => a - b), matches, newTags: result.new_tags };
}

/**
 * The export file: the journal as JSON, or, with photos or drawings, a zip
 * of it, the photos (each decrypted here) and a picture of each drawing.
 * @param {(text: string) => void} progress
 * @returns {Promise<{ name: string, content: string | Blob, type: string, unreadable: number, missing: number }>}
 */
async function buildExport(progress) {
  const sealed = await exportSealed();
  // Opened here, on the device: the file has the notes in plain text.
  const { doc, unreadable } = withoutUnreadableMarks(await convertJournal(sealed, open));
  const name = `notonawa-${doc.exported_at.slice(0, 10)}`;
  const items = [...doc.ties, ...doc.plans, ...doc.workshops];
  /** @type {any[]} */
  const entries = items.flatMap((x) => x.photos ?? []);
  /** @type {any[]} */
  const drawings = items.flatMap((x) => x.drawings ?? []);
  /** @type {any[]} */
  const poses = items.flatMap((x) => x.poses ?? []);

  let unreadableCaptions = 0;
  // Drawings' and poses' captions are sealed like notes; a caption that won't open is left out.
  for (const [kind, list] of /** @type {const} */ ([["drawing", drawings], ["pose", poses]])) {
    const opened = await open(kind, list.map((d) => ({ caption: d.caption })));
    opened.forEach((c, i) => {
      list[i].caption = c.caption;
      if (c.unreadable?.length) unreadableCaptions++;
    });
  }
  if (entries.length === 0 && drawings.length === 0) {
    return {
      name: `${name}.json`, content: JSON.stringify(doc, null, 2), type: "application/json",
      unreadable: unreadable + unreadableCaptions, missing: 0,
    };
  }

  const captions = await openMedia(entries.map((e) => ({ id: e.id, caption: e.caption })));
  captions.forEach((c, i) => {
    entries[i].caption = c.caption;
    if (c.unreadable) unreadableCaptions++;
  });
  /** @type {{ name: string, data: Uint8Array<ArrayBuffer> }[]} */
  const files = [];
  let missing = 0;
  for (const [i, entry] of entries.entries()) {
    progress(`Decrypting photos and videos… ${i + 1} of ${entries.length}`);
    try {
      files.push({ name: entry.file, data: new Uint8Array(await openPhoto(entry.id, "full", entry.kind === "video" ? "video" : "photo")) });
    } catch {
      // Can't be decrypted (or fetched): listed without a file.
      entry.file = null;
      missing++;
    }
  }
  const colors = drawingColors();
  for (const drawing of drawings) {
    files.push({ name: drawing.file, data: /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(svgFile(drawing.data, colors))) });
  }
  const json = /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(JSON.stringify(doc, null, 2)));
  const zip = new Blob(makeZip([{ name: "notonawa.json", data: json }, ...files], new Date(doc.exported_at)), { type: "application/zip" });
  return { name: `${name}.zip`, content: zip, type: "application/zip", unreadable: unreadable + unreadableCaptions, missing };
}

/**
 * @param {HTMLElement} _root
 * @param {{ signal: AbortSignal }} options
 */
export function mount(_root, { signal }) {
  showSharedByMe($("#shared-by-me"), $("#shared-by-me-message"));
  showConnections($("#connections"), $("#connections-message"), signal);

  const fileInput = /** @type {HTMLInputElement} */ ($("#import-file"));
  const preview = $("#import-preview");
  const go = /** @type {HTMLButtonElement} */ ($("#import-go"));
  const importMessage = $("#import-message");

  /** The file being imported, once it's been read and previewed. @type {PendingImport | null} */
  let pending = null;
  /** The role names in the file being imported (an export's), if any. */
  let fileRoleNames = /** @type {ReturnType<typeof exportRoleNames>} */ (null);
  /** The file's poser default body, if it has one. @type {number[] | null} */
  let fileDefaultShape = null;
  /** The file's saved poser presets (account.pose_presets), names in plain text. @type {unknown[]} */
  let filePresets = [];

  $("#export").addEventListener("click", async () => {
    const message = $("#export-message");
    showMessage(message, "Getting your data…");
    try {
      const file = await buildExport((text) => showMessage(message, text));
      saveFile(file.name, file.content, file.type);
      const problems = [
        file.unreadable ? `${file.unreadable.toLocaleString()} notes or captions couldn't be decrypted and are left out.` : "",
        file.missing ? `${file.missing.toLocaleString()} photos couldn't be decrypted and are left out.` : "",
      ].filter(Boolean);
      showMessage(message, ["Downloaded.", ...problems].join(" "));
    } catch (err) {
      showMessage(message, "Couldn't export: " + errorMessage(err), true);
    }
  });

  fileInput.addEventListener("change", async () => {
    pending = null;
    go.hidden = true;
    preview.hidden = true;
    preview.replaceChildren();
    showMessage(importMessage, "");
    const file = fileInput.files?.[0];
    if (!file) return;
    showMessage(importMessage, "Reading the file…");
    try {
      const { doc: read, files } = await readImportFile(file);
      // Photos, drawings and poses come off first: their captions are plain text in the file.
      const photos = takePhotos(read);
      const drawings = takeDrawings(photos.doc);
      const poses = takePoses(drawings.doc);
      const doc = poses.doc;
      checkLinks(doc);
      // Sealed once, on the device; only the sealed copy is sent.
      const sealed = await convertJournal(doc, seal);
      // Sets the message itself (e.g. when there's nothing new).
      await showPreview({ plain: doc, sealed, photos, drawings, poses, files });
    } catch (err) {
      showMessage(importMessage, errorMessage(err), true);
    }
  });

  go.addEventListener("click", async () => {
    if (!pending) return;
    const { plain, sealed, photos, drawings, poses, files } = pending;
    go.disabled = true;
    fileInput.disabled = true;
    let added = 0;
    let skipped = 0;
    let workshopsAdded = 0;
    let workshopsSkipped = 0;
    try {
      showMessage(importMessage, "Importing…");
      const items = await importItems(itemsBody(sealed, false));
      /** @type {PhotoTarget[]} */
      const targets = [];
      /** @type {DrawingTarget[]} */
      const drawingTargets = [];
      /** @type {DrawingTarget<PoseEntry>[]} */
      const poseTargets = [];
      for (const plan of items.plans) {
        const entries = photos.plans.get(String(plan.file_id));
        if (entries && plan.id) targets.push({ item: { plan_id: plan.id }, entries, onlyIfEmpty: plan.matched });
        const drawn = drawings.plans.get(String(plan.file_id));
        if (drawn && plan.id) drawingTargets.push({ item: { plan_id: plan.id }, entries: drawn, onlyIfEmpty: plan.matched });
        const posed = poses.plans.get(String(plan.file_id));
        if (posed && plan.id) poseTargets.push({ item: { plan_id: plan.id }, entries: posed, onlyIfEmpty: plan.matched });
      }
      const plainBatches = batches(plain.ties);
      // The file's tie ids to mine, for the workshops' linked ties.
      /** @type {Map<string, string>} */
      const tieIds = new Map();
      for (const [n, batch] of batches(remapTies(sealed.ties, items)).entries()) {
        showMessage(importMessage, `Importing… ${(added + skipped).toLocaleString()} of ${ties(plain.ties.length)}`);
        // Duplicates are checked again for each batch, just before it's
        // saved, so importing again after a failure finishes the job.
        const { skip, matches } = await findDuplicates(batch, plainBatches[n]);
        const result = await importTies({ ties: batch, skip });
        added += result.added;
        skipped += result.skipped;
        batch.forEach((_, i) => {
          const entries = photos.ties.get(n * TIE_BATCH + i);
          const drawn = drawings.ties.get(n * TIE_BATCH + i);
          const posed = poses.ties.get(n * TIE_BATCH + i);
          const mine = result.ids[i] ?? matches.get(i);
          if (mine) tieIds.set(String(sealed.ties[n * TIE_BATCH + i]?.id), mine);
          if (entries && mine) targets.push({ item: { tie_id: mine }, entries, onlyIfEmpty: !result.ids[i] });
          if (drawn && mine) drawingTargets.push({ item: { tie_id: mine }, entries: drawn, onlyIfEmpty: !result.ids[i] });
          if (posed && mine) poseTargets.push({ item: { tie_id: mine }, entries: posed, onlyIfEmpty: !result.ids[i] });
        });
      }
      const plainWorkshops = batches(plain.workshops);
      for (const [n, batch] of batches(remapWorkshops(sealed.workshops, items, tieIds)).entries()) {
        showMessage(importMessage, `Importing workshops… ${(workshopsAdded + workshopsSkipped).toLocaleString()} of ${workshops(plain.workshops.length)}`);
        const { skip, matches } = await findWorkshopDuplicates(batch, plainWorkshops[n]);
        const result = await importWorkshops({ workshops: batch, skip });
        workshopsAdded += result.added;
        workshopsSkipped += result.skipped;
        batch.forEach((_, i) => {
          const entries = photos.workshops.get(n * TIE_BATCH + i);
          const drawn = drawings.workshops.get(n * TIE_BATCH + i);
          const posed = poses.workshops.get(n * TIE_BATCH + i);
          const mine = result.ids[i] ?? matches.get(i);
          if (entries && mine) targets.push({ item: { workshop_id: mine }, entries, onlyIfEmpty: !result.ids[i] });
          if (drawn && mine) drawingTargets.push({ item: { workshop_id: mine }, entries: drawn, onlyIfEmpty: !result.ids[i] });
          if (posed && mine) poseTargets.push({ item: { workshop_id: mine }, entries: posed, onlyIfEmpty: !result.ids[i] });
        });
      }
      forgetSearch();
      /** @type {Map<string, Placed>} */
      const placed = new Map();
      const drawingResult = drawingTargets.length
        ? await importSaved(drawingTargets, { list: listDrawings, save: saveDrawing, one: "drawing", many: "drawings", kind: "drawing" }, placed) : null;
      const poseResult = poseTargets.length
        ? await importSaved(poseTargets, { list: listPoses, save: savePose, one: "pose", many: "poses", kind: "pose" }, placed) : null;
      const photoResult = files && targets.length ? await importPhotos(targets, files, placed) : null;
      await putBackOrder(placed);
      const presetResult = filePresets.length ? await importPresets(filePresets) : null;
      const extras = [drawingResult, poseResult, photoResult, presetResult].filter(Boolean).join(" ") || null;
      // The file's role names, if mine are still the defaults.
      const tookNames = await adoptRoleNames(fileRoleNames).catch(() => false);
      // And its poser default body, if I haven't saved one.
      const tookShape = await adoptDefaultShape(fileDefaultShape).catch(() => false);
      preview.hidden = true;
      go.hidden = true;
      fileInput.value = "";
      pending = null;
      const unlinked = linksDroppedText(items.links_dropped);
      showMessage(importMessage, `Imported ${ties(added)}.` +
        (skipped ? ` Skipped ${ties(skipped)} already in your journal.` : "") +
        (workshopsAdded ? ` Imported ${workshops(workshopsAdded)}.` : "") +
        (workshopsSkipped ? ` Skipped ${workshops(workshopsSkipped)} already in your journal.` : "") +
        (extras ? ` ${extras}` : "") +
        (unlinked ? ` ${unlinked}` : "") +
        (tookNames ? " Your role names were set from the file (change them in Settings)." : "") +
        (tookShape ? " The poser's default body was set from the file." : ""), !!extras && /couldn't/.test(extras));
    } catch (err) {
      // Batches already saved stay saved; running it again skips them.
      showMessage(importMessage, `Couldn't finish: ${errorMessage(err)} ` +
        (added || workshopsAdded
          ? `Saved ${ties(added)}${workshopsAdded ? ` and ${workshops(workshopsAdded)}` : ""} so far. Import the same file again to add the rest: what's already saved is skipped.`
          : "Nothing was saved."), true);
    } finally {
      go.disabled = false;
      fileInput.disabled = false;
    }
  });

  /**
   * Uploads the imported ties' and plans' photos, one by one, from the
   * zip. A tie or plan that was already in the journal gets them only if
   * it has none yet.
   * @param {PhotoTarget[]} targets
   * @param {Map<string, Uint8Array<ArrayBuffer>>} files
   * @param {Map<string, Placed>} placed where each one added is noted
   * @returns {Promise<string>} what happened, in words
   */
  async function importPhotos(targets, files, placed) {
    const total = targets.reduce((sum, t) => sum + t.entries.length, 0);
    /** Whether videos can go up without their sound, once asked. @type {boolean | null} */
    let silentOk = null;
    let done = 0;
    let added = 0;
    let kept = 0;
    /** @type {string[]} */
    const problems = [];
    for (const target of targets) {
      if (target.onlyIfEmpty && (await listMedia(target.item)).length > 0) {
        done += target.entries.length;
        kept += target.entries.length;
        continue;
      }
      for (const entry of target.entries) {
        const counted = `${(++done).toLocaleString()} of ${total.toLocaleString()}`;
        showMessage(importMessage, `Adding photos and videos… ${counted}`);
        const data = files.get(entry.file);
        if (!data) {
          problems.push(`${entry.file} isn't in the zip.`);
          continue;
        }
        try {
          const file = new File([data], entry.file, { type: typeFromName(entry.file) });
          // A video is prepared again like one just chosen: whatever made
          // the zip, nothing but the re-encoded clip is stored.
          const prepared = entry.kind === "video"
            ? await (await import("../video-prep.js")).prepareVideo(file, {
              onProgress: (fraction) => showMessage(importMessage, `Adding photos and videos… ${counted} (${Math.round(fraction * 100)}%)`),
              // Asked once an import, not for every video.
              withoutSound: async () => (silentOk ??= await askWithoutSound(entry.file)),
            })
            : await preparePhoto(file);
          const id = await uploadPhoto({ item: target.item, prepared, caption: entry.caption });
          note(placed, target.item, "media", id, entry.position);
          added++;
        } catch (err) {
          problems.push(`${entry.file}: ${errorMessage(err)}`);
        }
      }
    }
    const photosText = (/** @type {number} */ n) => `${n.toLocaleString()} ${n === 1 ? "photo" : "photos"}`;
    return [
      added ? `Added ${photosText(added)}.` : "",
      kept ? `Skipped ${photosText(kept)} on ties, plans or workshops that already have photos.` : "",
      problems.length ? `${photosText(problems.length)} couldn't be added: ${problems.slice(0, 3).join(" ")}` : "",
    ].filter(Boolean).join(" ");
  }

  /**
   * Saves the imported ties', plans' and workshops' drawings (or poses), one
   * by one. One that was already in the journal gets them only if it has
   * none yet.
   * @template E
   * @param {DrawingTarget<E>[]} targets
   * @param {{
   *   list: (item: PhotoTarget["item"]) => Promise<unknown[]>, save: (item: PhotoTarget["item"], entry: E) => Promise<string>, one: string, many: string,
   *   kind: "drawing" | "pose",
   * }} kind where they're listed, how one is saved, and what they're called
   * @param {Map<string, Placed>} placed where each one added is noted
   * @returns {Promise<string>} what happened, in words
   */
  async function importSaved(targets, { list, save, one, many, kind }, placed) {
    const total = targets.reduce((sum, t) => sum + t.entries.length, 0);
    let done = 0;
    let added = 0;
    let kept = 0;
    /** @type {string[]} */
    const problems = [];
    for (const target of targets) {
      if (target.onlyIfEmpty && (await list(target.item)).length > 0) {
        done += target.entries.length;
        kept += target.entries.length;
        continue;
      }
      for (const entry of target.entries) {
        showMessage(importMessage, `Adding ${many}… ${(++done).toLocaleString()} of ${total.toLocaleString()}`);
        try {
          const id = await save(target.item, entry);
          note(placed, target.item, kind, id, /** @type {{ position?: number }} */ (entry).position ?? 0);
          added++;
        } catch (err) {
          problems.push(errorMessage(err));
        }
      }
    }
    const counted = (/** @type {number} */ n) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
    return [
      added ? `Added ${counted(added)}.` : "",
      kept ? `Skipped ${counted(kept)} on ties, plans or workshops that already have ${many}.` : "",
      problems.length ? `${counted(problems.length)} couldn't be added: ${problems.slice(0, 3).join(" ")}` : "",
    ].filter(Boolean).join(" ");
  }

  /**
   * Notes a visual an import added, and where it was in the file.
   * @param {Map<string, Placed>} placed
   * @param {PhotoTarget["item"]} item
   * @param {import("../visual-order.js").VisualKind} kind
   * @param {string} id
   * @param {number} position
   */
  function note(placed, item, kind, id, position) {
    const key = JSON.stringify(item);
    let entry = placed.get(key);
    if (!entry) placed.set(key, entry = { item, lists: { media: [], drawing: [], pose: [] } });
    entry.lists[kind].push({ id, position });
  }

  /**
   * Puts each item's imported visuals back in the order they had in the
   * file, photos, drawings and poses together (each kind went in after the
   * other). An item that had visuals already, or where one couldn't be
   * added, is left as it is: the server only takes an order with all of
   * them, and nothing is lost either way.
   * @param {Map<string, Placed>} placed
   */
  async function putBackOrder(placed) {
    for (const { item, lists } of placed.values()) {
      const order = orderBody(mergeVisuals(lists).map(({ kind, item: v }) => ({ kind, id: v.id })));
      if (order.length < 2) continue;
      try {
        await setVisualOrder(item, order);
      } catch {
        // As it was saved: each kind in the file's order.
      }
    }
  }

  /**
   * Reads an export (.json or, with photos, .zip) or a CSV of ties into an
   * import.
   * @param {File} file
   * @returns {Promise<{ doc: ImportDoc, files: Map<string, Uint8Array<ArrayBuffer>> | null }>}
   */
  async function readImportFile(file) {
    const buffer = await file.arrayBuffer();
    if (looksLikeZip(new Uint8Array(buffer))) {
      const files = await readZip(buffer);
      const name = journalEntry(files.keys());
      if (!name) throw new Error("This zip file isn't a NotoNawa export.");
      const data = parseJson(new TextDecoder().decode(files.get(name)));
      fileRoleNames = exportRoleNames(data);
      fileDefaultShape = exportDefaultShape(data);
      filePresets = presetsIn(data);
      return { doc: readExport(data), files };
    }
    const text = new TextDecoder().decode(buffer);
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
      const { doc, errors } = csvToImport(parseCsv(text));
      if (errors.length) throw new Error(`Fix these in the file, then choose it again:\n${errors.join("\n")}`);
      fileRoleNames = null;
      fileDefaultShape = null;
      filePresets = [];
      return { doc, files: null };
    }
    const data = parseJson(text);
    fileRoleNames = exportRoleNames(data);
    fileDefaultShape = exportDefaultShape(data);
    filePresets = presetsIn(data);
    return { doc: readExport(data), files: null };
  }

  /** @param {any} data an export, read as JSON */
  function presetsIn(data) {
    const list = data?.account?.pose_presets;
    return Array.isArray(list) ? list : [];
  }

  /** @param {string} text */
  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Choose a NotoNawa export (.json or .zip) or a CSV file.");
    }
  }

  /**
   * Asks the server what the import would do, without saving anything, and
   * shows it.
   * @param {PendingImport} file
   */
  async function showPreview(file) {
    const { plain, sealed, photos, drawings, poses, files } = file;
    const items = await importItems(itemsBody(sealed, true));
    let duplicates = 0;
    const newTags = new Set(items.new_tags);
    const plainBatches = batches(plain.ties);
    for (const [n, batch] of batches(sealed.ties).entries()) {
      const found = await findDuplicates(batch, plainBatches[n]);
      duplicates += found.skip.length;
      for (const tag of found.newTags) newTags.add(tag);
    }
    const toAdd = plain.ties.length - duplicates;
    const presets = filePresets.length ? presetsToAdd(filePresets, ...(await myPresets())) : null;
    let workshopDuplicates = 0;
    const plainWorkshops = batches(plain.workshops);
    for (const [n, batch] of batches(sealed.workshops).entries()) {
      const found = await findWorkshopDuplicates(batch, plainWorkshops[n]);
      workshopDuplicates += found.skip.length;
      for (const tag of found.newTags) newTags.add(tag);
    }
    const workshopsToAdd = plain.workshops.length - workshopDuplicates;

    /** @param {string} label @param {(string | null)[]} lines */
    const section = (label, lines) => {
      const shown = lines.filter(Boolean);
      return shown.length ? h("div", { className: "item" }, h("div", { className: "item-title" }, label),
        shown.map((line) => h("div", { className: "item-meta" }, line))) : null;
    };
    /** @param {string} label @param {any[]} results */
    const itemSection = (label, results) => {
      const { added, matched } = describeItems(results);
      return section(label, [added, matched]);
    };

    // Sections with nothing to say are left out.
    preview.replaceChildren(...[
      section("Ties", [
        `${toAdd.toLocaleString()} to add`,
        duplicates ? `${duplicates.toLocaleString()} already in your journal (skipped)` : null,
      ]),
      plain.workshops.length ? section("Workshops", [
        `${workshopsToAdd.toLocaleString()} to add`,
        workshopDuplicates ? `${workshopDuplicates.toLocaleString()} already in your journal (skipped)` : null,
      ]) : null,
      section("People", [...Object.values(describeItems(items.people)), linksDroppedText(items.links_dropped)]),
      itemSection("Locations", items.locations),
      itemSection("Plans", items.plans),
      newTags.size ? section("Tags", [`${newTags.size} new: ${[...newTags].join(", ")}`]) : null,
      photos.count ? section("Photos", [
        files ? `${photos.count.toLocaleString()} in the file (added to ties, plans and workshops that don't already have photos)`
          : `${photos.count.toLocaleString()} listed, but not in this file: import the .zip export to add them`,
      ]) : null,
      drawings.count ? section("Drawings", [
        `${drawings.count.toLocaleString()} in the file (added to ties, plans and workshops that don't already have drawings)`,
      ]) : null,
      poses.count ? section("Poses", [
        `${poses.count.toLocaleString()} in the file (added to ties, plans and workshops that don't already have poses)`,
      ]) : null,
      presets ? section("Poser presets", [
        `${presets.add.length.toLocaleString()} to add`,
        presets.skipped ? `${presets.skipped.toLocaleString()} you already have by name (skipped)` : null,
        presets.full ? `${presets.full.toLocaleString()} more than you have room for (you can keep up to ${MAX_PRESETS})` : null,
      ]) : null,
    ].filter((el) => el !== null));
    preview.hidden = false;

    showMessage(importMessage, "");
    const newItems = [items.people, items.locations, items.plans].some((list) => list.some((/** @type {any} */ r) => !r.matched));
    // Photos, drawings and poses may still need adding (an import run again to finish).
    if (toAdd === 0 && workshopsToAdd === 0 && !newItems && newTags.size === 0 && !(photos.count && files) && !drawings.count && !poses.count
      && !presets?.add.length) {
      showMessage(importMessage, "Everything in this file is already in your journal.");
      return;
    }
    pending = file;
    go.textContent = toAdd && workshopsToAdd ? `Import ${ties(toAdd)} and ${workshops(workshopsToAdd)}`
      : toAdd ? `Import ${ties(toAdd)}` : workshopsToAdd ? `Import ${workshops(workshopsToAdd)}` : "Import";
    go.hidden = false;
  }

  /**
   * My saved poser presets (names opened), and how many more I can keep.
   * @returns {Promise<[{ kind: string, name: string | null }[], number]>}
   */
  async function myPresets() {
    /** @type {{ kind: string, name: string | null }[]} */
    const mine = await listPosePresets();
    return [mine, MAX_PRESETS - mine.length];
  }

  /**
   * Adds the file's saved poser presets that I don't have by name, their
   * names sealed first.
   * @param {unknown[]} list
   * @returns {Promise<string | null>} what happened, for the message
   */
  async function importPresets(list) {
    try {
      const { add, full } = presetsToAdd(list, ...(await myPresets()));
      if (!add.length && !full) return null;
      await addPosePresets(add);
      return `Added ${add.length.toLocaleString()} poser ${add.length === 1 ? "preset" : "presets"}.` +
        (full ? ` ${full.toLocaleString()} more didn't fit: you can keep up to ${MAX_PRESETS}.` : "");
    } catch (err) {
      return `Couldn't add the poser presets: ${errorMessage(err)}`;
    }
  }

  /** "1 tie", "1,200 ties". @param {number} n */
  function ties(n) {
    return `${n.toLocaleString()} ${n === 1 ? "tie" : "ties"}`;
  }

  /** "1 workshop", "12 workshops". @param {number} n */
  function workshops(n) {
    return `${n.toLocaleString()} ${n === 1 ? "workshop" : "workshops"}`;
  }
}
