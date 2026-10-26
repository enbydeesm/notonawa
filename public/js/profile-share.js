// A profile invite's contents: what's taken from my own profile to share,
// and reading one someone else shared. Pure, so it's easy to test.
//
// A shared profile comes from another account, so it's read strictly, like
// anything typed by someone else: only these fields, only text (or a flag),
// each no longer than it could be here. Private notes are never shared.

import { tidyAliases } from "./aliases.js";
import { ROLES } from "./ties-view.js";

export const PROFILE_VERSION = 1;

/** The longest each shared field can be, in characters. */
export const LIMITS = /** @type {const} */ ({ name: 200, pronouns: 100, alias: 200, aliases: 30, based_in: 200, about: 20_000 });

/**
 * A shared profile.
 * @typedef {{
 *   v: 1, name: string, pronouns?: string, default_role?: string, aliases?: import("./aliases.js").Alias[],
 *   based_in?: string, is_educator?: true, about?: string,
 * }} SharedProfile
 */

/**
 * What to share: the name to share it under (typed in, as mine may be
 * "Me"), and which other fields. aliases: the positions of the ones to
 * share in my list. default_role: the role I usually take, as stored (its
 * name is each account's own, so it reads in theirs).
 * @typedef {{
 *   name: string, pronouns: boolean, default_role: boolean, aliases: number[], based_in: boolean, is_educator: boolean,
 *   about: boolean,
 * }} ProfileChoices
 */

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string | null} trimmed, or null if it isn't text, is empty or is too long
 */
function text(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

/**
 * The profile to share, from my own (opened) profile and what I chose.
 * Fields I didn't choose, or that are empty, are left out.
 * @param {{ pronouns?: string | null, default_role?: string | null, based_in?: string | null, is_educator?: unknown,
 *   about?: string | null }} me
 * @param {import("./aliases.js").Alias[]} myAliases
 * @param {ProfileChoices} choices
 * @returns {SharedProfile}
 */
export function buildProfile(me, myAliases, choices) {
  const name = text(choices.name, LIMITS.name);
  if (!name) throw new Error("Type the name to share.");
  /** @type {SharedProfile} */
  const profile = { v: PROFILE_VERSION, name };
  const pronouns = choices.pronouns ? text(me.pronouns, LIMITS.pronouns) : null;
  if (pronouns) profile.pronouns = pronouns;
  if (choices.default_role && me.default_role && ROLES.includes(me.default_role)) profile.default_role = me.default_role;
  const aliases = tidyAliases(choices.aliases.map((i) => myAliases[i]).filter(Boolean));
  if (aliases.length) profile.aliases = aliases;
  const basedIn = choices.based_in ? text(me.based_in, LIMITS.based_in) : null;
  if (basedIn) profile.based_in = basedIn;
  if (choices.is_educator && me.is_educator) profile.is_educator = true;
  const about = choices.about ? text(me.about, LIMITS.about) : null;
  if (about) profile.about = about;
  return profile;
}

/**
 * A profile someone shared, or null if it isn't one. Unknown fields are
 * dropped; a field that's the wrong type or too long is left out, but a
 * profile without a usable name isn't one.
 * @param {unknown} data
 * @returns {SharedProfile | null}
 */
export function readProfile(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = /** @type {Record<string, unknown>} */ (data);
  if (d.v !== PROFILE_VERSION) return null;
  const name = text(d.name, LIMITS.name);
  if (!name) return null;
  /** @type {SharedProfile} */
  const profile = { v: PROFILE_VERSION, name };
  const pronouns = text(d.pronouns, LIMITS.pronouns);
  if (pronouns) profile.pronouns = pronouns;
  if (typeof d.default_role === "string" && ROLES.includes(d.default_role)) profile.default_role = d.default_role;
  const aliases = tidyAliases(Array.isArray(d.aliases) ? d.aliases.slice(0, LIMITS.aliases) : [])
    .filter((a) => a.alias.length <= LIMITS.alias);
  if (aliases.length) profile.aliases = aliases;
  const basedIn = text(d.based_in, LIMITS.based_in);
  if (basedIn) profile.based_in = basedIn;
  if (d.is_educator === true) profile.is_educator = true;
  const about = text(d.about, LIMITS.about);
  if (about) profile.about = about;
  return profile;
}

/**
 * The name to suggest sharing: my profile's, unless it's still "Me" (every
 * journal starts with one), which would mean nothing on theirs.
 * @param {string} myName
 * @returns {string}
 */
export function suggestedName(myName) {
  const name = myName.trim();
  return /^me$/i.test(name) ? "" : name;
}
