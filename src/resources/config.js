// Plans, people and locations all work the same way, so each is described
// here once: its fields (with parsers), the columns to return, and the list
// order. Table and column names used in SQL only ever come from this file
// (never from the request), so they're safe to put in SQL text.

import { BadInput } from "../http.js";
import {
  cleanText, toIntOrNull, toNumberOrNull, toFlag, toChoiceOrNull, toUrlOrNull,
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
      description: { parse: cleanText },
      notes: { parse: cleanText },
      est_difficulty: { parse: (v) => toIntOrNull(v, 1, 5) },
      variation_of: { parse: cleanText },
    },
    columns: "id, title, stage, description, notes, est_difficulty, variation_of, version, archived_at, created_at, updated_at",
    orderBy: "updated_at DESC",
  },
  people: {
    fields: {
      name: { parse: cleanText, required: "Give the person a name." },
      pronouns: { parse: cleanText },
      notes: { parse: cleanText },
      is_self: { parse: toFlag },
    },
    columns: "id, name, pronouns, notes, is_self, archived_at, created_at, updated_at",
    orderBy: "is_self DESC, name COLLATE NOCASE",
  },
  locations: {
    fields: {
      name: { parse: cleanText, required: "Give the location a name." },
      notes: { parse: cleanText },
      hard_points: { parse: cleanText },
      maps_url: { parse: toUrlOrNull },
      latitude: { parse: (v) => toNumberOrNull(v, -90, 90) },
      longitude: { parse: (v) => toNumberOrNull(v, -180, 180) },
    },
    columns: "id, name, notes, hard_points, maps_url, latitude, longitude, archived_at, created_at, updated_at",
    orderBy: "name COLLATE NOCASE",
    // "Archive now" on the add screen: a one-off spot, saved but kept out of pickers.
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
