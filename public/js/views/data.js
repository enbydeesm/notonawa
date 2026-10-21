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

import { api, errorMessage } from "../api.js";
import { h, $, showMessage } from "../dom.js";
import { saveFile } from "../download.js";
import { parseCsv } from "../csv.js";
import { csvToImport } from "../import-csv.js";
import {
  readExport, exportRoleNames, itemsBody, remapTies, remapWorkshops, checkLinks, batches, describeItems, TIE_BATCH,
} from "../import-steps.js";
import { adoptRoleNames } from "../settings.js";
import { convertJournal, withoutUnreadableMarks } from "../journal-fields.js";
import { duplicateMatches } from "../import-dedupe.js";
import { takePhotos, typeFromName, journalEntry } from "../import-photos.js";
import { makeZip, readZip, looksLikeZip } from "../zip.js";
import { preparePhoto } from "../photo-prep.js";
import { uploadPhoto } from "../photo-upload.js";
import { askWithoutSound } from "../photos-ui.js";
import { seal, open, openMedia, openPhoto, forgetSearch } from "../vault.js";

/** @typedef {import("../import-steps.js").ImportDoc} ImportDoc */
/** @typedef {import("../import-photos.js").PhotoEntry} PhotoEntry */
/**
 * A file to import: as read (notes in plain text, to compare for
 * duplicates) and sealed (as sent), both without their photos; the photos
 * listed (ties' by position, plans' by file id); and the zip's files (null
 * for a .json or a CSV).
 * @typedef {{
 *   plain: ImportDoc, sealed: ImportDoc,
 *   photos: ReturnType<typeof takePhotos>, files: Map<string, Uint8Array<ArrayBuffer>> | null,
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
 * Which ties of a batch duplicate mine: the server finds candidates (the
 * same but for the notes), and their notes are opened and compared here.
 * Also says which tags are new.
 * @param {any[]} sealedBatch as sent
 * @param {any[]} plainBatch the same ties, notes in plain text
 * @returns {Promise<{ skip: number[], matches: Map<number, string>, newTags: string[] }>}
 */
async function findDuplicates(sealedBatch, plainBatch) {
  const result = await api("/api/data/import/ties", { method: "POST", body: { preview: true, ties: sealedBatch } });
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
  const result = await api("/api/data/import/workshops", { method: "POST", body: { preview: true, workshops: sealedBatch } });
  const candidates = /** @type {any[]} */ (await open("workshop", result.candidates));
  const matches = duplicateMatches(plainBatch, candidates, ["description", "notes"]);
  return { skip: [...matches.keys()].sort((a, b) => a - b), matches, newTags: result.new_tags };
}

/**
 * The export file: the journal as JSON, or, with photos, a zip of it and
 * the photos, each decrypted here.
 * @param {(text: string) => void} progress
 * @returns {Promise<{ name: string, content: string | Blob, type: string, unreadable: number, missing: number }>}
 */
async function buildExport(progress) {
  const sealed = await api("/api/data/export");
  // Opened here, on the device: the file has the notes in plain text.
  const { doc, unreadable } = withoutUnreadableMarks(await convertJournal(sealed, open));
  const name = `notonawa-${doc.exported_at.slice(0, 10)}`;
  /** @type {any[]} */
  const entries = [...doc.ties, ...doc.plans, ...doc.workshops].flatMap((x) => x.photos ?? []);
  if (entries.length === 0) {
    return { name: `${name}.json`, content: JSON.stringify(doc, null, 2), type: "application/json", unreadable, missing: 0 };
  }

  let unreadableCaptions = 0;
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
  const json = /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(JSON.stringify(doc, null, 2)));
  const zip = new Blob(makeZip([{ name: "notonawa.json", data: json }, ...files], new Date(doc.exported_at)), { type: "application/zip" });
  return { name: `${name}.zip`, content: zip, type: "application/zip", unreadable: unreadable + unreadableCaptions, missing };
}

export function mount() {

  const fileInput = /** @type {HTMLInputElement} */ ($("#import-file"));
  const preview = $("#import-preview");
  const go = /** @type {HTMLButtonElement} */ ($("#import-go"));
  const importMessage = $("#import-message");

  /** The file being imported, once it's been read and previewed. @type {PendingImport | null} */
  let pending = null;
  /** The role names in the file being imported (an export's), if any. */
  let fileRoleNames = /** @type {ReturnType<typeof exportRoleNames>} */ (null);

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
      // Photos come off first: their captions are plain text in the file.
      const photos = takePhotos(read);
      const doc = photos.doc;
      checkLinks(doc);
      // Sealed once, on the device; only the sealed copy is sent.
      const sealed = await convertJournal(doc, seal);
      // Sets the message itself (e.g. when there's nothing new).
      await showPreview({ plain: doc, sealed, photos, files });
    } catch (err) {
      showMessage(importMessage, errorMessage(err), true);
    }
  });

  go.addEventListener("click", async () => {
    if (!pending) return;
    const { plain, sealed, photos, files } = pending;
    go.disabled = true;
    fileInput.disabled = true;
    let added = 0;
    let skipped = 0;
    let workshopsAdded = 0;
    let workshopsSkipped = 0;
    try {
      showMessage(importMessage, "Importing…");
      const items = await api("/api/data/import/items", { method: "POST", body: itemsBody(sealed, false) });
      /** @type {PhotoTarget[]} */
      const targets = [];
      for (const plan of items.plans) {
        const entries = photos.plans.get(String(plan.file_id));
        if (entries && plan.id) targets.push({ item: { plan_id: plan.id }, entries, onlyIfEmpty: plan.matched });
      }
      const plainBatches = batches(plain.ties);
      for (const [n, batch] of batches(remapTies(sealed.ties, items)).entries()) {
        showMessage(importMessage, `Importing… ${(added + skipped).toLocaleString()} of ${ties(plain.ties.length)}`);
        // Duplicates are checked again for each batch, just before it's
        // saved, so importing again after a failure finishes the job.
        const { skip, matches } = await findDuplicates(batch, plainBatches[n]);
        const result = await api("/api/data/import/ties", { method: "POST", body: { ties: batch, skip } });
        added += result.added;
        skipped += result.skipped;
        batch.forEach((_, i) => {
          const entries = photos.ties.get(n * TIE_BATCH + i);
          const mine = result.ids[i] ?? matches.get(i);
          if (entries && mine) targets.push({ item: { tie_id: mine }, entries, onlyIfEmpty: !result.ids[i] });
        });
      }
      const plainWorkshops = batches(plain.workshops);
      for (const [n, batch] of batches(remapWorkshops(sealed.workshops, items)).entries()) {
        showMessage(importMessage, `Importing workshops… ${(workshopsAdded + workshopsSkipped).toLocaleString()} of ${workshops(plain.workshops.length)}`);
        const { skip, matches } = await findWorkshopDuplicates(batch, plainWorkshops[n]);
        const result = await api("/api/data/import/workshops", { method: "POST", body: { workshops: batch, skip } });
        workshopsAdded += result.added;
        workshopsSkipped += result.skipped;
        batch.forEach((_, i) => {
          const entries = photos.workshops.get(n * TIE_BATCH + i);
          const mine = result.ids[i] ?? matches.get(i);
          if (entries && mine) targets.push({ item: { workshop_id: mine }, entries, onlyIfEmpty: !result.ids[i] });
        });
      }
      forgetSearch();
      const photoResult = files && targets.length ? await importPhotos(targets, files) : null;
      // The file's role names, if mine are still the defaults.
      const tookNames = await adoptRoleNames(fileRoleNames).catch(() => false);
      preview.hidden = true;
      go.hidden = true;
      fileInput.value = "";
      pending = null;
      showMessage(importMessage, `Imported ${ties(added)}.` +
        (skipped ? ` Skipped ${ties(skipped)} already in your journal.` : "") +
        (workshopsAdded ? ` Imported ${workshops(workshopsAdded)}.` : "") +
        (workshopsSkipped ? ` Skipped ${workshops(workshopsSkipped)} already in your journal.` : "") +
        (photoResult ? ` ${photoResult}` : "") +
        (tookNames ? " Your role names were set from the file (change them in Settings)." : ""), !!photoResult && /couldn't/.test(photoResult));
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
   * @returns {Promise<string>} what happened, in words
   */
  async function importPhotos(targets, files) {
    const total = targets.reduce((sum, t) => sum + t.entries.length, 0);
    /** Whether videos can go up without their sound, once asked. @type {boolean | null} */
    let silentOk = null;
    let done = 0;
    let added = 0;
    let kept = 0;
    /** @type {string[]} */
    const problems = [];
    for (const target of targets) {
      if (target.onlyIfEmpty && (await api(`/api/media?${new URLSearchParams(target.item)}`)).length > 0) {
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
          await uploadPhoto({ item: target.item, prepared, caption: entry.caption });
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
      return { doc: readExport(data), files };
    }
    const text = new TextDecoder().decode(buffer);
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
      const { doc, errors } = csvToImport(parseCsv(text));
      if (errors.length) throw new Error(`Fix these in the file, then choose it again:\n${errors.join("\n")}`);
      fileRoleNames = null;
      return { doc, files: null };
    }
    const data = parseJson(text);
    fileRoleNames = exportRoleNames(data);
    return { doc: readExport(data), files: null };
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
    const { plain, sealed, photos, files } = file;
    const items = await api("/api/data/import/items", { method: "POST", body: itemsBody(sealed, true) });
    let duplicates = 0;
    const newTags = new Set(items.new_tags);
    const plainBatches = batches(plain.ties);
    for (const [n, batch] of batches(sealed.ties).entries()) {
      const found = await findDuplicates(batch, plainBatches[n]);
      duplicates += found.skip.length;
      for (const tag of found.newTags) newTags.add(tag);
    }
    const toAdd = plain.ties.length - duplicates;
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
      itemSection("People", items.people),
      itemSection("Locations", items.locations),
      itemSection("Plans", items.plans),
      newTags.size ? section("Tags", [`${newTags.size} new: ${[...newTags].join(", ")}`]) : null,
      photos.count ? section("Photos", [
        files ? `${photos.count.toLocaleString()} in the file (added to ties, plans and workshops that don't already have photos)`
          : `${photos.count.toLocaleString()} listed, but not in this file: import the .zip export to add them`,
      ]) : null,
    ].filter((el) => el !== null));
    preview.hidden = false;

    showMessage(importMessage, "");
    const newItems = [items.people, items.locations, items.plans].some((list) => list.some((/** @type {any} */ r) => !r.matched));
    // Photos may still need adding (an import run again to finish).
    if (toAdd === 0 && workshopsToAdd === 0 && !newItems && newTags.size === 0 && !(photos.count && files)) {
      showMessage(importMessage, "Everything in this file is already in your journal.");
      return;
    }
    pending = file;
    go.textContent = toAdd && workshopsToAdd ? `Import ${ties(toAdd)} and ${workshops(workshopsToAdd)}`
      : toAdd ? `Import ${ties(toAdd)}` : workshopsToAdd ? `Import ${workshops(workshopsToAdd)}` : "Import";
    go.hidden = false;
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
