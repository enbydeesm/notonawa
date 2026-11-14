// Your data's export (format 2): the account part from the server's export
// (passkeys, notices, feedback, shares: it has no journal rows for a
// format 2 account) and the journal from the records in memory
// (store/queries/export.js), in format 1's shape, everything already open.
// Import comes in the next slice.

import { api } from "../../api.js";
import { records, unreadableCount } from "./journal.js";
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

/** @param {...any} _args */
async function notYet(..._args) {
  throw new Error("Importing isn't ready in this version yet.");
}

export const exportSealed = notYet;
export const importItems = notYet;
export const importTies = notYet;
export const importWorkshops = notYet;
