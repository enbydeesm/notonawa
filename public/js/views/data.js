// "Your data" view: export everything to a file, or import ties from an
// export or a CSV. Files are read here in the browser; only the entries in
// them are sent, in the same way as typing them in (see import-steps.js).

import { api, errorMessage } from "../api.js";
import { h, $, showMessage } from "../dom.js";
import { saveFile } from "../download.js";
import { parseCsv } from "../csv.js";
import { csvToImport } from "../import-csv.js";
import { readExport, itemsBody, remapTies, checkLinks, batches, describeItems } from "../import-steps.js";

/** @typedef {import("../import-steps.js").ImportDoc} ImportDoc */

export function mount() {

  const fileInput = /** @type {HTMLInputElement} */ ($("#import-file"));
  const preview = $("#import-preview");
  const go = /** @type {HTMLButtonElement} */ ($("#import-go"));
  const importMessage = $("#import-message");

  /** The file being imported, once it's been read and previewed. @type {ImportDoc | null} */
  let pending = null;

  $("#export").addEventListener("click", async () => {
    const message = $("#export-message");
    showMessage(message, "Getting your data…");
    try {
      const data = await api("/api/data/export");
      saveFile(`rope-journal-${data.exported_at.slice(0, 10)}.json`, JSON.stringify(data, null, 2), "application/json");
      showMessage(message, "Downloaded.");
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
      // Sets the message itself (e.g. when there's nothing new).
      await showPreview(doc);
    } catch (err) {
      showMessage(importMessage, errorMessage(err), true);
    }
  });

  go.addEventListener("click", async () => {
    if (!pending) return;
    const doc = pending;
    go.disabled = true;
    fileInput.disabled = true;
    let added = 0;
    let skipped = 0;
    try {
      showMessage(importMessage, "Importing…");
      const items = await api("/api/data/import/items", { method: "POST", body: itemsBody(doc, false) });
      for (const batch of batches(remapTies(doc.ties, items))) {
        showMessage(importMessage, `Importing… ${(added + skipped).toLocaleString()} of ${ties(doc.ties.length)}`);
        const result = await api("/api/data/import/ties", { method: "POST", body: { ties: batch } });
        added += result.added;
        skipped += result.skipped;
      }
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
   * @param {ImportDoc} doc
   */
  async function showPreview(doc) {
    const items = await api("/api/data/import/items", { method: "POST", body: itemsBody(doc, true) });
    let duplicates = 0;
    const newTags = new Set(items.new_tags);
    for (const batch of batches(doc.ties)) {
      const result = await api("/api/data/import/ties", { method: "POST", body: { preview: true, ties: batch } });
      duplicates += result.duplicates.length;
      for (const tag of result.new_tags) newTags.add(tag);
    }
    const toAdd = doc.ties.length - duplicates;

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
    pending = doc;
    go.textContent = toAdd ? `Import ${ties(toAdd)}` : "Import";
    go.hidden = false;
  }

  /** "1 tie", "1,200 ties". @param {number} n */
  function ties(n) {
    return `${n.toLocaleString()} ${n === 1 ? "tie" : "ties"}`;
  }
}
