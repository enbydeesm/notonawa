// Plans, people and locations all work the same way, so each is described
// here once: its fields (with parsers), the columns to return, and the list
// order. Table and column names used in SQL only ever come from this file
// (never from the request), so they're safe to put in SQL text.

import { BadInput } from "../http.js";
import { toRoleOrNull, TIE_TYPES } from "../ties/parse.js";
import {
  cleanText, toIntOrNull, toNumberOrNull, toFlag, toChoiceOrNull, toUrlOrNull, encryptedText, toDateOrNull,
} from "../parse.js";

export const PLAN_STAGES = ["idea", "developing", "ready", "retired"];
/** What a plan is (migration 0011); the Plans form shows this, not the stage. */
export const PLAN_TYPES = ["idea", "harness", "sequence"];

/**
 * @typedef {{ parse: (value: unknown) => unknown, required?: string, createOnly?: boolean }} Field
 *   createOnly: set when the item is added, left as it is by edits
 * @typedef {{
 *   fields: Record<string, Field>,
 *   columns: string,
 *   orderBy: string,
 *   archiveOnCreate?: boolean,
 *   tagged?: boolean,
 *   jsonColumns?: string[],
 * }} Resource
 *   tagged: has tags (sent and listed as names; saved through routes.js,
 *   as they're links, not a column)
 *   jsonColumns: columns listed as JSON text, which listRows parses
 * @typedef {"plans" | "people" | "locations"} ResourceName
 */

/** @type {Record<ResourceName, Resource>} */
export const RESOURCES = {
  plans: {
    fields: {
      title: { parse: cleanText, required: "Give the plan a title." },
      // No longer on the form: set when added, left alone by edits.
      stage: { parse: (v) => toChoiceOrNull(v, PLAN_STAGES) ?? "idea", createOnly: true },
      // Encrypted in the browser (see encryptedText).
      description: { parse: encryptedText },
      notes: { parse: encryptedText },
      est_difficulty: { parse: (v) => toIntOrNull(v, 1, 5) },
      variation_of: { parse: cleanText },
      plan_type: { parse: (v) => toChoiceOrNull(v, PLAN_TYPES) ?? "idea" },
      // Optional, unlike a tie's (migration 0014).
      tie_type: { parse: (v) => toChoiceOrNull(v, TIE_TYPES) },
      album_url: { parse: encryptedText },
    },
    // tags: a JSON list of names, A–Z. linked_ties: a JSON list of the ties
    // it's on, newest first, with what the Plans page shows of them (titles
    // and ratings aren't encrypted). listRows reads both.
    columns: `id, title, stage, plan_type, tie_type, description, notes, album_url, est_difficulty, variation_of, version,
              archived_at, created_at, updated_at,
              (SELECT COUNT(*) FROM media m WHERE m.plan_id = plans.id) AS photo_count,
              (SELECT json_group_array(name) FROM (SELECT t.name FROM plan_tags pt JOIN tags t ON t.id = pt.tag_id
                WHERE pt.plan_id = plans.id ORDER BY t.name COLLATE NOCASE)) AS tags,
              (SELECT json_group_array(json_object('id', id, 'title', title, 'tie_date', tie_date, 'success_rating', success_rating))
                 FROM (SELECT t.id, t.title, t.tie_date, t.success_rating FROM tie_plans tp JOIN ties t ON t.id = tp.tie_id
                        WHERE tp.plan_id = plans.id AND t.owner_id = plans.owner_id
                        ORDER BY t.tie_date DESC, t.created_at DESC)) AS linked_ties`,
    orderBy: "updated_at DESC",
    // "Add & archive" in the tie form's plan picker.
    archiveOnCreate: true,
    tagged: true,
    jsonColumns: ["tags", "linked_ties"],
  },
  people: {
    fields: {
      name: { parse: cleanText, required: "Give the person a name." },
      pronouns: { parse: cleanText },
      notes: { parse: encryptedText },
      // "This is me": set at sign-up (or on an import into a journal without
      // one); the database allows one. Edits can't change who it is.
      is_self: { parse: toFlag, createOnly: true },
      // Filled in when they're added to a tie; still changeable there.
      default_role: { parse: toRoleOrNull },
      // Who shows up in a workshop's educators list (migration 0016).
      is_educator: { parse: toFlag },
      // Encrypted in the browser: aliases is a sealed JSON list of
      // { platform, alias } (public/js/aliases.js).
      based_in: { parse: encryptedText },
      aliases: { parse: encryptedText },
      // "About me" on my own profile, what a profile invite can share; on
      // anyone else's, what they shared (migration 0021). Encrypted; notes
      // stay private.
      about: { parse: encryptedText },
      // When their About was last shared by them (migration 0024): plain.
      about_shared_on: { parse: toDateOrNull },
    },
    columns: "id, name, pronouns, notes, is_self, default_role, is_educator, based_in, aliases, about, about_shared_on, archived_at, created_at, updated_at",
    orderBy: "is_self DESC, name COLLATE NOCASE",
    // "Add & archive" in the tie form's people picker: someone tied with once.
    archiveOnCreate: true,
  },
  locations: {
    fields: {
      name: { parse: cleanText, required: "Give the location a name." },
      notes: { parse: encryptedText },
      maps_url: { parse: toUrlOrNull },
      // Where it is (migration 0017): plain text, typed in.
      city: { parse: cleanText },
      state_province: { parse: cleanText },
      country: { parse: cleanText },
      latitude: { parse: (v) => toNumberOrNull(v, -90, 90) },
      longitude: { parse: (v) => toNumberOrNull(v, -180, 180) },
      // The location new ties start with; one at most (migration 0011).
      // Setting it clears the old one (routes.js).
      is_default: { parse: toFlag },
    },
    columns: "id, name, notes, maps_url, city, state_province, country, latitude, longitude, is_default, archived_at, created_at, updated_at",
    orderBy: "name COLLATE NOCASE",
    // "Archive now" on the add screen and "Add & archive" in the tie form: a
    // one-off spot, saved but kept out of pickers.
    archiveOnCreate: true,
  },
};

/** @type {ResourceName[]} */
export const RESOURCE_NAMES = /** @type {ResourceName[]} */ (Object.keys(RESOURCES));

/**
 * Runs every field's parser over a submitted body.
 * Returns the columns and values in matching order. An edit leaves out the
 * fields only set when an item is added (createOnly).
 * @param {Resource} resource
 * @param {Record<string, unknown>} body
 * @param {{ editing?: boolean }} [options]
 * @returns {{ columns: string[], values: unknown[] }}
 */
export function parseFields(resource, body, { editing = false } = {}) {
  const columns = [];
  const values = [];
  for (const [column, field] of Object.entries(resource.fields)) {
    if (editing && field.createOnly) continue;
    const value = field.parse(body[column]);
    if (field.required && value === null) throw new BadInput(field.required);
    columns.push(column);
    values.push(value);
  }
  return { columns, values };
}

/**
 * Edits that aren't allowed for a particular resource.
 * @param {ResourceName} name
 * @param {string} id
 * @param {{ columns: string[], values: unknown[] }} parsed
 */
export function checkEdit(name, id, { columns, values }) {
  if (name === "plans" && values[columns.indexOf("variation_of")] === id) {
    throw new BadInput("A plan can't be a variation of itself.");
  }
}

/** @typedef {"true" | "false" | "all"} ArchivedFilter */
export const ARCHIVED_FILTERS = /** @type {const} */ (["true", "false", "all"]);

/**
 * The required ?archived= on list requests. Required (no default) so a page
 * that forgets it fails loudly instead of quietly showing archived items in a
 * picker, or hiding them from a history.
 * @param {string | null} value
 * @returns {ArchivedFilter}
 */
export function parseArchivedFilter(value) {
  if (value === null || !(/** @type {readonly string[]} */ (ARCHIVED_FILTERS)).includes(value)) {
    throw new BadInput("Say which items to list: archived=false (active), archived=true or archived=all.");
  }
  return /** @type {ArchivedFilter} */ (value);
}
