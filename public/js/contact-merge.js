// Adding a profile someone shared to my People: as a new person, or onto a
// card I already have for them, choosing field by field whether to take
// theirs or keep mine. Pure, so it's easy to test.
//
// Their About replaces the card's (it's theirs: "About them"), with the
// date they shared it; an invite without one leaves both as they were. My
// private notes are never touched.

import { readAliases, aliasesText, tidyAliases } from "./aliases.js";

/** @typedef {import("./profile-share.js").SharedProfile} SharedProfile */
/** @typedef {import("./aliases.js").Alias} Alias */

/**
 * A person as the People list has them (opened).
 * @typedef {{
 *   name: string, pronouns: string | null, notes: string | null, default_role: string | null,
 *   is_educator: number | boolean, based_in: string | null, aliases: string | null, about: string | null,
 *   about_shared_on?: string | null,
 * }} Person
 */

/**
 * A field where theirs differs from mine, and which to keep by default.
 * @typedef {{
 *   field: "name" | "pronouns" | "default_role" | "based_in" | "is_educator", label: string,
 *   mine: string, theirs: string, choice: "mine" | "theirs",
 * }} FieldChoice
 */

/** What to do with their social and scene names. @typedef {"add" | "replace" | "keep"} AliasChoice */

/**
 * The fields to ask about: those they shared that differ from my card's.
 * The name I know them by, and the role I've set for them, are kept unless
 * I choose theirs; the rest take theirs (it's what they've told me).
 * @param {Person} mine
 * @param {SharedProfile} theirs
 * @param {(role: string) => string} [roleLabel] how a role is shown (roleName)
 * @returns {FieldChoice[]}
 */
export function fieldChoices(mine, theirs, roleLabel = (role) => role) {
  /** @type {FieldChoice[]} */
  const choices = [];
  /**
   * @param {FieldChoice["field"]} field
   * @param {string} label
   * @param {string | null | undefined} myValue
   * @param {string | undefined} theirValue
   * @param {"mine" | "theirs"} choice
   */
  const ask = (field, label, myValue, theirValue, choice) => {
    if (theirValue === undefined || theirValue === (myValue ?? "")) return;
    choices.push({ field, label, mine: myValue ?? "", theirs: theirValue, choice });
  };
  ask("name", "Name", mine.name, theirs.name, "mine");
  ask("pronouns", "Pronouns", mine.pronouns, theirs.pronouns, "theirs");
  if (theirs.default_role && theirs.default_role !== mine.default_role) {
    choices.push({
      field: "default_role", label: "Usual role", mine: mine.default_role ? roleLabel(mine.default_role) : "",
      theirs: roleLabel(theirs.default_role), choice: mine.default_role ? "mine" : "theirs",
    });
  }
  ask("based_in", "Based in", mine.based_in, theirs.based_in, "theirs");
  if (theirs.is_educator && !mine.is_educator) ask("is_educator", "Educator", "No", "Yes", "theirs");
  return choices;
}

/**
 * Their social and scene names that my card doesn't have yet.
 * @param {Person} mine
 * @param {SharedProfile} theirs
 * @returns {Alias[]}
 */
export function newAliases(mine, theirs) {
  const have = new Set(readAliases(mine.aliases).map(aliasKey));
  return (theirs.aliases ?? []).filter((a) => !have.has(aliasKey(a)));
}

/** @param {Alias} a */
const aliasKey = (a) => `${a.platform}:${a.alias.toLowerCase()}`;

/**
 * My card with their profile merged in, as the whole record PUT
 * /api/people/:id takes (every field, or the ones left out are emptied).
 * @param {Person} mine
 * @param {SharedProfile} theirs
 * @param {FieldChoice[]} choices as fieldChoices made them, each with its choice
 * @param {AliasChoice} aliases
 * @param {string} today YYYY-MM-DD: when their About was shared, if they shared one
 */
export function mergedPerson(mine, theirs, choices, aliases, today) {
  const take = (/** @type {FieldChoice["field"]} */ field) => choices.some((c) => c.field === field && c.choice === "theirs");
  const myAliases = readAliases(mine.aliases);
  const aliasList = aliases === "replace" ? (theirs.aliases ?? [])
    : aliases === "add" ? [...myAliases, ...newAliases(mine, theirs)]
    : myAliases;
  return {
    name: take("name") ? theirs.name : mine.name,
    pronouns: take("pronouns") ? (theirs.pronouns ?? null) : mine.pronouns,
    notes: mine.notes,
    default_role: take("default_role") ? (theirs.default_role ?? null) : mine.default_role,
    is_educator: take("is_educator") ? true : !!mine.is_educator,
    based_in: take("based_in") ? (theirs.based_in ?? null) : mine.based_in,
    aliases: aliasesText(aliasList),
    about: theirs.about ?? mine.about,
    about_shared_on: theirs.about ? today : (mine.about_shared_on ?? null),
  };
}

/**
 * A new person from their profile, as POST /api/people takes it.
 * @param {SharedProfile} theirs
 * @param {string} today YYYY-MM-DD
 */
export function newPerson(theirs, today) {
  return {
    name: theirs.name,
    pronouns: theirs.pronouns ?? null,
    notes: null,
    default_role: theirs.default_role ?? null,
    is_educator: !!theirs.is_educator,
    based_in: theirs.based_in ?? null,
    aliases: aliasesText(tidyAliases(theirs.aliases ?? [])),
    about: theirs.about ?? null,
    about_shared_on: theirs.about ? today : null,
  };
}
