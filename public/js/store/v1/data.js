// Your data's export and import, through today's API (format 1). These pass
// today's sealed shapes through as they are (the pages seal and open them,
// journal-fields.js); the encrypted cache's version builds the export and
// does the import on the device instead. See store/index.js.

import { api } from "../../api.js";
import { open, openMedia, seal } from "../../vault.js";
import { convertJournal, withoutUnreadableMarks } from "../../journal-fields.js";

/**
 * The whole journal as GET /api/data/export gives it, notes still sealed.
 * @returns {Promise<any>}
 */
export function exportSealed() {
  return api("/api/data/export");
}

/**
 * Adds an import's people, locations and plans (preview: only says what
 * would happen).
 * @param {Record<string, unknown>} body as POST /api/data/import/items takes it
 * @returns {Promise<any>}
 */
export function importItems(body) {
  return api("/api/data/import/items", { method: "POST", body });
}

/**
 * Adds a batch of an import's ties, or with preview finds duplicates.
 * @param {Record<string, unknown>} body as POST /api/data/import/ties takes it
 * @returns {Promise<any>}
 */
export function importTies(body) {
  return api("/api/data/import/ties", { method: "POST", body });
}

/**
 * Adds a batch of an import's workshops, or with preview finds duplicates.
 * @param {Record<string, unknown>} body as POST /api/data/import/workshops takes it
 * @returns {Promise<any>}
 */
export function importWorkshops(body) {
  return api("/api/data/import/workshops", { method: "POST", body });
}

/**
 * The whole journal for the export file, opened on the device: notes,
 * drawings', poses' and photos' captions in plain text. What won't open is
 * left out, and counted.
 * @returns {Promise<{ doc: any, unreadable: number }>}
 */
export async function exportJournal() {
  const { doc, unreadable } = withoutUnreadableMarks(await convertJournal(await exportSealed(), open));
  const items = [...doc.ties, ...doc.plans, ...doc.workshops];
  let unreadableCaptions = 0;
  // Drawings' and poses' captions are sealed like notes.
  for (const kind of /** @type {const} */ (["drawing", "pose"])) {
    /** @type {any[]} */
    const list = items.flatMap((x) => x[`${kind}s`] ?? []);
    const opened = await open(kind, list.map((d) => ({ caption: d.caption })));
    opened.forEach((c, i) => {
      list[i].caption = c.caption;
      if (c.unreadable?.length) unreadableCaptions++;
    });
  }
  // Photos' captions are sealed bound to the photo.
  /** @type {any[]} */
  const entries = items.flatMap((x) => x.photos ?? []);
  const captions = await openMedia(entries.map((e) => ({ id: e.id, caption: e.caption })));
  captions.forEach((c, i) => {
    entries[i].caption = c.caption;
    if (c.unreadable) unreadableCaptions++;
  });
  return { doc, unreadable: unreadable + unreadableCaptions };
}

/**
 * An import's notes and other sealed fields sealed on the device, before
 * anything is sent: format 1's server keeps them as they come.
 * @template T
 * @param {T} doc
 * @returns {Promise<T>}
 */
export function sealImport(doc) {
  return /** @type {Promise<T>} */ (convertJournal(/** @type {any} */ (doc), seal));
}
