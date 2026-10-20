// The account's settings on the page: role names (roles.js) and light/dark
// mode (theme.js), read once the journal is unlocked and saved from the
// Settings dialog (settings-dialog.js), the last release notes seen
// (whats-new.js) and whether to show the welcome (welcome.js). See
// src/account/settings.js.

import { api } from "./api.js";
import { setRoleNames, namesToAdopt } from "./roles.js";
import { THEME_KEY, parseChoice, shownTheme } from "./theme.js";
import { onWipe } from "./vault.js";

/**
 * @typedef {{
 *   top_label: string | null, bottom_label: string | null, theme: string | null, seen_release: string | null,
 *   hide_welcome: boolean,
 * }} Settings
 */

/** Fired on document when Settings saves new role names, so the view redraws with them. */
export const SETTINGS_SAVED = "settings-saved";

/** @type {Settings | null} */
let loaded = null;

/**
 * Reads my settings (once per unlock) and puts them to use. An account
 * that hasn't chosen a mode yet (from before modes were saved) keeps the
 * one this device is showing, saved for its other devices.
 * @returns {Promise<Settings>}
 */
export async function loadSettings() {
  if (loaded) return loaded;
  const settings = /** @type {Settings} */ (await api("/api/account/settings"));
  loaded = settings;
  setRoleNames(settings);
  const theme = parseChoice(settings.theme);
  if (theme) showTheme(theme);
  else saveTheme(currentTheme()).catch(() => {});
  return settings;
}

/** The settings as last read or saved; null before loadSettings(). */
export function currentSettings() {
  return loaded;
}

/**
 * Saves new role names (empty for the default), then has the view redraw
 * (unless redraw is false: the Your data view, which shows no roles, keeps
 * its import message).
 * @param {string} top
 * @param {string} bottom
 * @param {{ redraw?: boolean }} [options]
 */
export async function saveRoleNames(top, bottom, { redraw = true } = {}) {
  const settings = /** @type {Settings} */ (await api("/api/account/settings", {
    method: "PUT", body: { top_label: top, bottom_label: bottom },
  }));
  loaded = settings;
  setRoleNames(settings);
  if (redraw) document.dispatchEvent(new CustomEvent(SETTINGS_SAVED));
}

/**
 * After an import: takes the file's role names if I'm still on the
 * defaults (see namesToAdopt).
 * @param {{ top_label: string | null, bottom_label: string | null } | null} fromFile
 * @returns {Promise<boolean>} whether they were taken
 */
export async function adoptRoleNames(fromFile) {
  const names = namesToAdopt(await loadSettings(), fromFile);
  if (!names) return false;
  await saveRoleNames(names.top, names.bottom, { redraw: false });
  return true;
}

/**
 * Remembers on my account that I've seen this version's release notes.
 * @param {string} version
 */
export async function saveSeenRelease(version) {
  const settings = await api("/api/account/settings", { method: "PUT", body: { seen_release: version } });
  if (loaded) loaded = { ...loaded, seen_release: settings.seen_release };
}

/**
 * Remembers on my account that the welcome shouldn't be shown again.
 */
export async function saveHideWelcome() {
  const settings = await api("/api/account/settings", { method: "PUT", body: { hide_welcome: true } });
  if (loaded) loaded = { ...loaded, hide_welcome: settings.hide_welcome };
}

/** @returns {import("./theme.js").Theme} the mode on screen */
export function currentTheme() {
  return shownTheme(parseChoice(document.documentElement.dataset.theme));
}

/**
 * Shows a mode now and saves it to my account, so my other devices use it
 * too. The page keeps it even if saving fails (e.g. offline).
 * @param {import("./theme.js").Theme} theme
 */
export async function saveTheme(theme) {
  showTheme(theme);
  const settings = await api("/api/account/settings", { method: "PUT", body: { theme } });
  if (loaded) loaded = { ...loaded, theme: settings.theme };
}

/**
 * Shows a mode, and remembers it on this device for theme-init.js. Just a
 * convenience: if storage is blocked, the account's mode still applies
 * once signed in.
 * @param {import("./theme.js").Theme} theme
 */
function showTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage blocked
  }
}

// Locking (or signing out) may mean someone else signs in next: back to the
// default names until their settings are read. The mode stays on screen.
onWipe(() => {
  loaded = null;
  setRoleNames(null);
});
