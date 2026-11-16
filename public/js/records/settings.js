// The settings a format 2 account keeps in its sealed settings record: the
// words shown for top and bottom, and the body new poses start with. The
// rest (light or dark mode, the release notes and welcome seen) stay on the
// server, shown before the journal is unlocked. The server's checks
// (src/account/settings.js), with its messages. Pure.

import { BadEdit, cleanText } from "./parse.js";

/** In the record, not on the server. */
export const RECORD_SETTINGS = /** @type {const} */ (["top_label", "bottom_label", "default_shape"]);
export const MAX_ROLE_NAME = 24;
/** The poser's sliders: gender, muscle, weight, height (src/poses/parse.js's, kept in step by a unit test). */
export const SHAPE_RANGES = Object.freeze([[0, 100], [0, 100], [0, 100], [150, 200]]);
const OTHER_ROLES = ["self tie", "spotter", "photographer", "audit"];

/**
 * A role name as kept: trimmed, inner spaces collapsed; null for empty or
 * for the role's own name.
 * @param {unknown} value
 * @param {"top" | "bottom"} role
 * @returns {string | null}
 */
export function roleName(value, role) {
  if (value !== null && value !== undefined && typeof value !== "string") throw new BadEdit("A role name should be text.");
  const name = cleanText(value)?.replace(/\s+/g, " ") ?? null;
  if (name === null || name.toLowerCase() === role) return null;
  if (name.length > MAX_ROLE_NAME) throw new BadEdit(`Keep role names to ${MAX_ROLE_NAME} characters or fewer.`);
  if (OTHER_ROLES.includes(name.toLowerCase())) throw new BadEdit(`"${name}" is already a role. Choose another name.`);
  return name;
}

/**
 * A default body shape: four whole numbers within the sliders, or null.
 * @param {unknown} value
 * @returns {number[] | null}
 */
export function defaultShape(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== SHAPE_RANGES.length
    || !value.every((n, i) => Number.isInteger(n) && n >= SHAPE_RANGES[i][0] && n <= SHAPE_RANGES[i][1])) {
    throw new BadEdit("That isn't a body shape the poser has.");
  }
  return [...value];
}

/**
 * The settings record with a change made: only the record's settings,
 * checked; the two role names must differ.
 * @param {Record<string, any>} body the record's now
 * @param {Record<string, unknown>} change
 * @param {string} now
 */
export function settingsChanged(body, change, now) {
  /** @type {Record<string, any>} */
  const next = { ...body, updated_at: now };
  if (change.top_label !== undefined) next.top_label = roleName(change.top_label, "top");
  if (change.bottom_label !== undefined) next.bottom_label = roleName(change.bottom_label, "bottom");
  if (change.default_shape !== undefined) next.default_shape = defaultShape(change.default_shape);
  const top = next.top_label ?? "top";
  const bottom = next.bottom_label ?? "bottom";
  if (top.toLowerCase() === bottom.toLowerCase()) throw new BadEdit("Give the two roles different names.");
  for (const name of RECORD_SETTINGS) if (next[name] === null) delete next[name];
  return next;
}
