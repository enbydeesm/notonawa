// Account settings, the same on every device: the words shown for the top
// and bottom roles, and light or dark mode (migration 0013), and the last
// release whose notes I've seen (migration 0014), and whether to stop
// showing the welcome (migration 0015). Pure, so it's easy to test. The
// page's side is public/js/roles.js, theme.js, whats-new.js and welcome.js.
//
// A role name is stored only when it differs from the role itself, so an
// account that never chose one keeps following the defaults. Role names
// are plain text (like tag names), not encrypted: the page shows them
// before the journal is unlocked.

import { BadInput } from "../http.js";
import { cleanText } from "../parse.js";

export const THEMES = ["light", "dark"];
export const MAX_ROLE_NAME = 24;
/** A version, as scripts/releases-lib.mjs writes them: a deploy's UTC date and time (2026.10.28.2104), or a release's number that day in older ones (2026.10.19.001). */
const RELEASE_FORMAT = /^\d{4}\.\d{2}\.\d{2}\.(\d{3}|\d{4})$/;
/** Words a role name can't be, as they'd be confused with another role. */
const OTHER_ROLES = ["self tie", "spotter", "photographer"];

/**
 * @typedef {{
 *   top_label: string | null, bottom_label: string | null, theme: string | null, seen_release: string | null,
 *   hide_welcome: boolean,
 * }} Settings
 * @typedef {Partial<Settings>} SettingsChange only the settings sent
 */

/**
 * The body of PUT /api/account/settings: any of top_label and bottom_label
 * (a word, or empty for the default), theme ("light" or "dark") and
 * seen_release (a version, e.g. 2026.10.19.001) and hide_welcome (true or
 * false).
 * Checked against `current` so the two role names never end up the same.
 * @param {Record<string, unknown>} body
 * @param {Settings} current
 * @returns {SettingsChange}
 */
export function parseSettings(body, current) {
  /** @type {SettingsChange} */
  const change = {};
  if (body.top_label !== undefined) change.top_label = roleName(body.top_label, "top");
  if (body.bottom_label !== undefined) change.bottom_label = roleName(body.bottom_label, "bottom");
  if (body.theme !== undefined) {
    if (typeof body.theme !== "string" || !THEMES.includes(body.theme)) throw new BadInput("Choose light or dark.");
    change.theme = body.theme;
  }
  if (body.seen_release !== undefined) {
    if (typeof body.seen_release !== "string" || !RELEASE_FORMAT.test(body.seen_release)) {
      throw new BadInput("That isn't a version of the app.");
    }
    change.seen_release = body.seen_release;
  }
  if (body.hide_welcome !== undefined) {
    if (typeof body.hide_welcome !== "boolean") throw new BadInput("Say whether to show the welcome again.");
    change.hide_welcome = body.hide_welcome;
  }
  if (!Object.keys(change).length) throw new BadInput("Nothing to change.");

  const top = shown("top", "top_label" in change ? change.top_label : current.top_label);
  const bottom = shown("bottom", "bottom_label" in change ? change.bottom_label : current.bottom_label);
  if (top.toLowerCase() === bottom.toLowerCase()) throw new BadInput("Give the two roles different names.");
  return change;
}

/**
 * A role name as stored: trimmed, inner spaces collapsed; null for empty
 * or for the role's own name.
 * @param {unknown} value
 * @param {"top" | "bottom"} role
 * @returns {string | null}
 */
function roleName(value, role) {
  if (value !== null && typeof value !== "string") throw new BadInput("A role name should be text.");
  const name = cleanText(value)?.replace(/\s+/g, " ") ?? null;
  if (name === null || name.toLowerCase() === role) return null;
  if (name.length > MAX_ROLE_NAME) throw new BadInput(`Keep role names to ${MAX_ROLE_NAME} characters or fewer.`);
  if (OTHER_ROLES.includes(name.toLowerCase())) throw new BadInput(`"${name}" is already a role. Choose another name.`);
  return name;
}

/**
 * @param {"top" | "bottom"} role
 * @param {string | null | undefined} label
 */
function shown(role, label) {
  return label ?? role;
}
