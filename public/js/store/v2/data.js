// Your data's export and import (format 2). The export: the account part
// from the server's export (passkeys, notices, feedback, shares: it has no
// journal rows for a format 2 account) and the journal from the records in
// memory (store/queries/export.js), in format 1's shape, everything already
// open. The import: format 1's requests and answers, worked out on the
// device (records/import.js) and saved as records; nothing is sealed first,
// as the records are sealed whole when they're saved.

import { api } from "../../api.js";
import { records, unreadableCount, save } from "./journal.js";
import { newId } from "../../records/ids.js";
import { stamp } from "../../records/parse.js";
import * as plan from "../../records/import.js";
import { journalExport } from "../queries/export.js";
import { RECORD_KINDS } from "../../crypto/records.js";

/**
 * The whole journal for the export file, in plain text. Records that won't
 * open are left out, and counted.
 * @returns {Promise<{ doc: any, unreadable: number }>}
 */
export async function exportJournal() {
  const server = await api("/api/data/export");
  const journal = journalExport(Object.fromEntries(RECORD_KINDS.map((kind) => [kind, records(kind)])));
  const { settings, pose_presets: presets, ...lists } = journal;
  const doc = {
    ...server,
    account: { ...server.account, settings: { ...server.account.settings, ...settings }, pose_presets: presets },
    ...lists,
  };
  return { doc, unreadable: unreadableCount() };
}

/** My records by kind, for an import to match and check against. */
const mine = () => Object.fromEntries(RECORD_KINDS.map((kind) => [kind, records(kind)]));

/**
 * @param {{ result: any, writes: import("../../records/edits.js").Write[] }} planned
 */
async function saved(planned) {
  if (planned.writes.length) await save({ writes: planned.writes });
  return planned.result;
}

/**
 * The import, plain: format 2 seals each record whole when it's saved.
 * @template T
 * @param {T} doc
 * @returns {Promise<T>}
 */
export async function sealImport(doc) {
  return doc;
}

/**
 * Adds an import's people, locations and plans (preview: only says what
 * would happen).
 * @param {Record<string, any>} body as POST /api/data/import/items took it
 */
export async function importItems(body) {
  return saved(plan.importItems(body, mine(), newId, stamp()));
}

/**
 * Adds a batch of an import's ties, or with preview finds duplicates.
 * @param {Record<string, any>} body
 */
export async function importTies(body) {
  return saved(plan.importTies(body, mine(), newId, stamp()));
}

/**
 * Adds a batch of an import's workshops, or with preview finds duplicates.
 * @param {Record<string, any>} body
 */
export async function importWorkshops(body) {
  return saved(plan.importWorkshops(body, mine(), newId, stamp()));
}

/** Format 1's sealed export isn't format 2's: the store's exportJournal gives the journal. */
export async function exportSealed() {
  throw new Error("Use exportJournal.");
}
