// My settings (role names, the poser's default body, the mode, the release
// notes and welcome seen), through today's API (format 1). settings.js
// keeps them in memory and puts them to use. See store/index.js.

import { api } from "../../api.js";

/** @typedef {import("../../settings.js").Settings} Settings */

/** @returns {Promise<Settings>} */
export function getSettings() {
  return api("/api/account/settings");
}

/**
 * Saves the settings given, leaving the rest as they are.
 * @param {Partial<Settings>} change
 * @returns {Promise<Settings>} all of them, as saved
 */
export function saveSettings(change) {
  return api("/api/account/settings", { method: "PUT", body: change });
}
