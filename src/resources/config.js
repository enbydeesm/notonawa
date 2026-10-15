// Plans, people and locations all work the same way, so each is described
// here once: its fields (with parsers), the columns to return, and the list
// order. Table and column names used in SQL only ever come from this file
// (never from the request), so they're safe to put in SQL text.

import { BadInput } from "../http.js";
import { ROLES } from "../ties/parse.js";
import {
  cleanText, toIntOrNull, toNumberOrNull, toFlag, toChoiceOrNull, toUrlOrNull, encryptedText,
} from "../parse.js";

export const PLAN_STAGES = ["idea", "developing", "ready", "retired"];

/**
 * @typedef {{ parse: (value: unknown) => unknown, required?: string }} Field
 * @typedef {{
 *   fields: Record<string, Field>,
 *   columns: string,
 *   orderBy: string,
 *   archiveOnCreate?: boolean,
 * }} Resource
 * @typedef {"plans" | "people" | "locations"} ResourceName
 */

/** @type {Record<ResourceName, Resource>} */
export const RESOURCES = {
  plans: {
    fields: {
      title: { parse: cleanText, required: "Give the plan a title." },
      stage: { parse: (v) => toChoiceOrNull(v, PLAN_STAGES) ?? "idea" },
      // Encrypted in the browser (see encryptedText).
      description: { parse: encryptedText },
      notes: { parse: encryptedText },
      est_difficulty: { parse: (v) => toIntOrNull(v, 1, 5) },
      variation_of: { parse: cleanText },
    },
    columns: "id, title, stage, description, notes, est_difficulty, variation_of, version, archived_at, created_at, updated_at",
    orderBy: "updated_at DESC",
    // "Add & archive" in the tie form's plan picker.
    archiveOnCreate: true,
  },
  people: {
    fields: {
      name: { parse: cleanText, required: "Give the person a name." },
      pronouns: { parse: cleanText },
      notes: { parse: encryptedText },
      is_self: { parse: toFlag },
      // Filled in when they're added to a tie; still changeable there.
      default_role: { parse: (v) => toChoiceOrNull(v, ROLES) },
    },
    columns: "id, name, pronouns, notes, is_self, default_role, archived_at, created_at, updated_at",
    orderBy: "is_self DESC, name COLLATE NOCASE",
    // "Add & archive" in the tie form's people picker: someone tied with once.
    archiveOnCreate: true,
  },
  locations: {
    fields: {
      name: { parse: cleanText, required: "Give the location a name." },
      notes: { parse: encryptedText },
      maps_url: { parse: toUrlOrNull },
      latitude: { parse: (v) => toNumberOrNull(v, -90, 90) },
      longitude: { parse: (v) => toNumberOrNull(v, -180, 180) },
    },
    columns: "id, name, notes, maps_url, latitude, longitude, archived_at, created_at, updated_at",
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
 * Returns the columns and values in matching order.
 * @param {Resource} resource
 * @param {Record<string, unknown>} body
 * @returns {{ columns: string[], values: unknown[] }}
 */
export function parseFields(resource, body) {
  const columns = [];
  const values = [];
  for (const [column, field] of Object.entries(resource.fields)) {
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
