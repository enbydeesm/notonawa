// "Your data" view: export everything to a file, or import ties from an
// export or a CSV. Files are read here in the browser; only the entries in
// them are sent, in the same way as typing them in (see import-steps.js).
// Notes are encrypted: an export opens them on the device before the file
// is saved, and an import seals them before anything is sent.

import { api, errorMessage } from "../api.js";
import { h, $, showMessage } from "../dom.js";
import { saveFile } from "../download.js";
import { parseCsv } from "../csv.js";
import { csvToImport } from "../import-csv.js";
import { readExport, itemsBody, remapTies, checkLinks, batches, describeItems } from "../import-steps.js";
import { convertJournal, withoutUnreadableMarks } from "../journal-fields.js";
import { duplicatePositions } from "../import-dedupe.js";
import { seal, open, forgetSearch } from "../vault.js";

/** @typedef {import("../import-steps.js").ImportDoc} ImportDoc */
/**
 * A file to import: as read (notes in plain text, to compare for
 * duplicates) and sealed (as sent).
 * @typedef {{ plain: ImportDoc, sealed: ImportDoc }} PendingImport
 */

/**
 * Which ties of a batch duplicate mine: the server finds candidates (the
 * same but for the notes), and their notes are opened and compared here.
 * Also says which tags are new.
 * @param {any[]} sealedBatch as sent
 * @param {any[]} plainBatch the same ties, notes in plain text
 * @returns {Promise<{ skip: number[], newTags: string[] }>}
 */
async function findDuplicates(sealedBatch, plainBatch) {
  const result = await api("/api/data/import/ties", { method: "POST", body: { preview: true, ties: sealedBatch } });
  const candidates = /** @type {{ i: number, notes: string | null }[]} */ (await open("tie", result.candidates));
  return { skip: duplicatePositions(plainBatch, candidates), newTags: result.new_tags };
}

export function mount() {

  const fileInput = /** @type {HTMLInputElement} */ ($("#import-file"));
  const preview = $("#import-preview");
  const go = /** @type {HTMLButtonElement} */ ($("#import-go"));
  const importMessage = $("#import-message");

  /** The file being imported, once it's been read and previewed. @type {PendingImport | null} */
  let pending = null;

  $("#export").addEventListener("click", async () => {
    const message = $("#export-message");
    showMessage(message, "Getting your data…");
    try {
      const sealed = await api("/api/data/export");
      // Opened here, on the device: the file has the notes in plain text.
      const { doc, unreadable } = withoutUnreadableMarks(await convertJournal(sealed, open));
      saveFile(`rope-journal-${doc.exported_at.slice(0, 10)}.json`, JSON.stringify(doc, null, 2), "application/json");
      showMessage(message, unreadable
        ? `Downloaded. ${unreadable.toLocaleString()} notes couldn't be decrypted and are left out.`
        : "Downloaded.");
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
      const doc = await readImportFile(file);
      checkLinks(doc);
      // Sealed once, on the device; only the sealed copy is sent.
      const sealed = await convertJournal(doc, seal);
      // Sets the message itself (e.g. when there's nothing new).
      await showPreview({ plain: doc, sealed });
    } catch (err) {
      showMessage(importMessage, errorMessage(err), true);
    }
  });

  go.addEventListener("click", async () => {
    if (!pending) return;
    const { plain, sealed } = pending;
    go.disabled = true;
    fileInput.disabled = true;
    let added = 0;
    let skipped = 0;
    try {
      showMessage(importMessage, "Importing…");
      const items = await api("/api/data/import/items", { method: "POST", body: itemsBody(sealed, false) });
      const plainBatches = batches(plain.ties);
      for (const [n, batch] of batches(remapTies(sealed.ties, items)).entries()) {
        showMessage(importMessage, `Importing… ${(added + skipped).toLocaleString()} of ${ties(plain.ties.length)}`);
        // Duplicates are checked again for each batch, just before it's
        // saved, so importing again after a failure finishes the job.
        const { skip } = await findDuplicates(batch, plainBatches[n]);
        const result = await api("/api/data/import/ties", { method: "POST", body: { ties: batch, skip } });
        added += result.added;
        skipped += result.skipped;
      }
      forgetSearch();
      preview.hidden = true;
      go.hidden = true;
      fileInput.value = "";
      pending = null;
      showMessage(importMessage, `Imported ${ties(added)}.` +
        (skipped ? ` Skipped ${ties(skipped)} already in your journal.` : ""));
    } catch (err) {
      // Batches already saved stay saved; running it again skips them.
      showMessage(importMessage, `Couldn't finish: ${errorMessage(err)} ` +
        (added ? `Saved ${ties(added)} so far. Import the same file again to add the rest: ties already saved are skipped.` : "Nothing was saved."), true);
    } finally {
      go.disabled = false;
      fileInput.disabled = false;
    }
  });

  /**
   * Reads an export (.json) or a CSV of ties into an import.
   * @param {File} file
   * @returns {Promise<ImportDoc>}
   */
  async function readImportFile(file) {
    const text = await file.text();
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
      const { doc, errors } = csvToImport(parseCsv(text));
      if (errors.length) throw new Error(`Fix these in the file, then choose it again:\n${errors.join("\n")}`);
      return doc;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Choose a Rope Journal export (.json) or a CSV file.");
    }
    return readExport(data);
  }

  /**
   * Asks the server what the import would do, without saving anything, and
   * shows it.
   * @param {PendingImport} file
   */
  async function showPreview(file) {
    const { plain, sealed } = file;
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
      itemSection("People", items.people),
      itemSection("Locations", items.locations),
      itemSection("Plans", items.plans),
      newTags.size ? section("Tags", [`${newTags.size} new: ${[...newTags].join(", ")}`]) : null,
    ].filter((el) => el !== null));
    preview.hidden = false;

    showMessage(importMessage, "");
    const newItems = [items.people, items.locations, items.plans].some((list) => list.some((/** @type {any} */ r) => !r.matched));
    if (toAdd === 0 && !newItems && newTags.size === 0) {
      showMessage(importMessage, "Everything in this file is already in your journal.");
      return;
    }
    pending = file;
    go.textContent = toAdd ? `Import ${ties(toAdd)}` : "Import";
    go.hidden = false;
  }

  /** "1 tie", "1,200 ties". @param {number} n */
  function ties(n) {
    return `${n.toLocaleString()} ${n === 1 ? "tie" : "ties"}`;
  }
}
