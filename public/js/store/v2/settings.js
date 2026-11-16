// My settings (format 2): role names and the poser's default body from the
// sealed settings record, the rest (mode, release notes and welcome seen)
// from the server, as one, the same as v1/settings.js gives them.

import { api } from "../../api.js";
import { recordIds } from "../../vault.js";
import { records, save } from "./journal.js";
import { stamp } from "../../records/parse.js";
import { RECORD_SETTINGS, settingsChanged } from "../../records/settings.js";

/** @typedef {import("../../settings.js").Settings} Settings */

/** The settings record (made with the journal: journal.js's ensureBasics). */
async function settingsRecord() {
  const [found] = records("settings");
  if (found) return found;
  const { settings } = await recordIds({ settings: true });
  return { kind: "settings", id: /** @type {string} */ (settings), version: 0, body: { created_at: stamp() } };
}

/**
 * @param {Record<string, any>} server
 * @param {Record<string, any>} body
 * @returns {Settings}
 */
function merged(server, body) {
  return /** @type {Settings} */ ({
    ...server, top_label: body.top_label ?? null, bottom_label: body.bottom_label ?? null, default_shape: body.default_shape ?? null,
  });
}

/** @returns {Promise<Settings>} */
export async function getSettings() {
  return merged(await api("/api/account/settings"), (await settingsRecord()).body ?? {});
}

/**
 * Saves the settings given, leaving the rest as they are: the record's in
 * the record, the others on the server.
 * @param {Partial<Settings>} change
 * @returns {Promise<Settings>} all of them, as saved
 */
export async function saveSettings(change) {
  const entry = await settingsRecord();
  /** @type {Record<string, any>} */
  const forRecord = {};
  /** @type {Record<string, any>} */
  const forServer = {};
  for (const [name, value] of Object.entries(change)) {
    if ((/** @type {readonly string[]} */ (RECORD_SETTINGS)).includes(name)) forRecord[name] = value;
    else forServer[name] = value;
  }
  let body = entry.body ?? {};
  if (Object.keys(forRecord).length) {
    body = settingsChanged(body, forRecord, stamp());
    await save({ writes: [{ kind: "settings", id: entry.id, body, from: entry.body ?? undefined }] });
  }
  const server = Object.keys(forServer).length
    ? await api("/api/account/settings", { method: "PUT", body: forServer })
    : await api("/api/account/settings");
  return merged(server, body);
}
