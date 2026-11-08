// The words shown for the roles. Top and bottom are one role each, and each
// account chooses what they're called (Settings; users.top_label and
// bottom_label, empty for "top" and "bottom"). Every place the app shows a
// role, or reads one someone typed (a CSV), goes through here.
//
// Pure apart from holding the names in use: settings.js sets them once the
// journal is unlocked (and back to the defaults when it locks), so anything
// drawn after that uses them.

import { ROLES, WORKSHOP_ROLES } from "./ties-view.js";
import { capitalise } from "./format.js";

/** @typedef {{ top: string, bottom: string }} RoleNames */

/** @type {RoleNames} */
export const DEFAULT_NAMES = { top: "top", bottom: "bottom" };
/** What older exports, CSVs and pages call top and bottom. */
const OLD_NAMES = /** @type {Record<string, string>} */ ({ rigger: "top", model: "bottom" });

/** @type {RoleNames} */
let names = DEFAULT_NAMES;

/**
 * @param {{ top_label?: string | null, bottom_label?: string | null } | null} settings
 * @returns {RoleNames}
 */
export function namesFrom(settings) {
  return { top: settings?.top_label || DEFAULT_NAMES.top, bottom: settings?.bottom_label || DEFAULT_NAMES.bottom };
}

/** @param {{ top_label?: string | null, bottom_label?: string | null } | null} settings */
export function setRoleNames(settings) {
  names = namesFrom(settings);
}

/** @returns {RoleNames} */
export function roleNames() {
  return names;
}

/**
 * A role as shown: "rigger" for top if that's what top is called.
 * @param {string} role
 * @param {RoleNames} [using]
 */
export function roleName(role, using = names) {
  return role === "top" ? using.top : role === "bottom" ? using.bottom : role;
}

/**
 * The roles for a drop-down, in order, with their shown names.
 * @param {RoleNames} [using]
 * @returns {{ value: string, label: string }[]}
 */
export function roleOptions(using = names) {
  return ROLES.map((role) => ({ value: role, label: capitalise(roleName(role, using)) }));
}

/**
 * The roles for a workshop's drop-downs: the tie roles, then Audit, which
 * only workshops have.
 * @param {RoleNames} [using]
 * @returns {{ value: string, label: string }[]}
 */
export function workshopRoleOptions(using = names) {
  return WORKSHOP_ROLES.map((role) => ({ value: role, label: capitalise(roleName(role, using)) }));
}

/**
 * A row's role once a person is picked: their usual role if they have
 * one, or else the role already chosen (blank if none was).
 * @param {string} current the row's role before the pick ("" for none)
 * @param {string | undefined} defaultRole the person's usual role
 * @param {readonly string[]} [allowed] the roles the row offers
 * @returns {string}
 */
export function roleAfterPick(current, defaultRole, allowed = WORKSHOP_ROLES) {
  return defaultRole && allowed.includes(defaultRole) ? defaultRole : current;
}

/**
 * The role a typed word means, ignoring capitals and extra spaces: the
 * account's own names first, then the roles' names, then "rigger" and
 * "model" as top and bottom. Null if it's none of them.
 * @param {string} text
 * @param {RoleNames} [using]
 * @returns {string | null}
 */
export function roleFromName(text, using = names) {
  const word = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (word === using.top.toLowerCase()) return "top";
  if (word === using.bottom.toLowerCase()) return "bottom";
  if (ROLES.includes(word)) return word;
  return Object.hasOwn(OLD_NAMES, word) ? OLD_NAMES[word] : null;
}

/**
 * The role names an import should take from its file: the file's, but only
 * while the journal is still on the default names, so names I chose are
 * never replaced. Null: keep mine.
 * @param {{ top_label?: string | null, bottom_label?: string | null }} mine
 * @param {{ top_label: string | null, bottom_label: string | null } | null} fromFile
 */
export function namesToAdopt(mine, fromFile) {
  if (!fromFile || mine.top_label || mine.bottom_label) return null;
  return { top: fromFile.top_label ?? "", bottom: fromFile.bottom_label ?? "" };
}
