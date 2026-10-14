// Turning a CSV of ties (one per row) into an import, in the export's shape
// (see import-steps.js). Pure, so it's easy to test.
//
// Columns, in any order (only date or title is needed; see
// /import-template.csv):
//   date      2026-10-12
//   title
//   type      suspension, partial suspension or floor
//   duration  minutes
//   rating    1 to 5
//   location  a name
//   people    Sam (model); Alex (rigger)
//   plans     plan titles, separated by ;
//   tags      separated by ;
//   notes
// People, locations and plans are matched to the journal's by name when
// imported; names it doesn't have are added.

import { ROLES, TIE_TYPES } from "./ties-view.js";
import { tagKey } from "./tags.js";

/** Column names as written in the file -> the field they fill. */
const COLUMNS = /** @type {const} */ ({
  date: "date", tie_date: "date",
  title: "title",
  type: "type", tie_type: "type",
  duration: "duration", duration_minutes: "duration", minutes: "duration",
  rating: "rating", success_rating: "rating",
  location: "location",
  people: "people", participants: "people",
  plans: "plans", plan: "plans",
  tags: "tags",
  notes: "notes",
});
const KNOWN = "date, title, type, duration, rating, location, people, plans, tags, notes";
const MAX_ERRORS = 20;

/**
 * @typedef {import("./import-steps.js").ImportDoc} ImportDoc
 * @typedef {{ doc: ImportDoc, errors: string[] }} CsvImport
 */

/**
 * @param {string[][]} rows the file's rows, the first being the headings
 * @returns {CsvImport} errors name the spreadsheet row ("Row 3: …"); if
 *   there are any, nothing should be imported
 */
export function csvToImport(rows) {
  const [header = [], ...body] = rows;
  /** @type {string[]} */
  const errors = [];
  const fields = header.map((h) => /** @type {Record<string, string>} */ (COLUMNS)[h.trim().toLowerCase().replace(/[\s-]+/g, "_")]);
  // No date column: most likely the headings are missing, so that's the one
  // thing to say. (Every tie needs a date.)
  if (!fields.includes("date")) {
    errors.push("The first row needs the column names, with a date column.");
    return { doc: { people: [], locations: [], plans: [], tags: [], ties: [] }, errors };
  }
  const unknown = header.filter((h, i) => h.trim() && !fields[i]);
  if (unknown.length) errors.push(`Unknown column${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Use ${KNOWN}.`);

  const people = new Names("person");
  const locations = new Names("location");
  const plans = new Names("plan");
  const ties = [];

  for (const [index, cells] of body.entries()) {
    if (cells.every((c) => !c.trim())) continue; // blank row
    const rowNumber = index + 2; // as the spreadsheet numbers it, headings being row 1
    /** @type {Record<string, string>} */
    const get = {};
    fields.forEach((f, i) => { if (f) get[f] = (cells[i] ?? "").trim(); });
    try {
      ties.push(rowToTie(get, { people, locations, plans }));
    } catch (err) {
      if (errors.length < MAX_ERRORS) errors.push(`Row ${rowNumber}: ${err instanceof Error ? err.message : err}`);
      else if (errors.length === MAX_ERRORS) errors.push("…and more.");
    }
  }
  if (!ties.length && !errors.length) errors.push("There are no ties in the file.");

  return {
    doc: { people: people.list("name"), locations: locations.list("name"), plans: plans.list("title"), tags: [], ties },
    errors,
  };
}

/**
 * @param {Record<string, string>} get the row's cells by field
 * @param {{ people: Names, locations: Names, plans: Names }} names
 */
function rowToTie(get, { people, locations, plans }) {
  const date = get.date || null;
  if (date !== null && !isDate(date)) throw new Error(`Write the date as year-month-day, like 2026-10-12 (not "${date}").`);
  const title = get.title || null;
  if (!date) throw new Error("Add a date.");
  return {
    title,
    tie_date: date,
    tie_type: tieType(get.type),
    duration_minutes: wholeNumber(get.duration, 0, 1440, "The duration"),
    success_rating: wholeNumber(get.rating, 1, 5, "The rating"),
    notes: get.notes || null,
    location_id: get.location ? locations.id(get.location) : null,
    participants: list(get.people).map((entry) => {
      const m = entry.match(/^(.+?)\s*\(\s*([^()]+?)\s*\)$/);
      if (!m) throw new Error(`Give ${entry} a role, like "${entry} (model)".`);
      const role = m[2].toLowerCase();
      if (!ROLES.includes(role)) throw new Error(`"${m[2]}" isn't a role. Use one of: ${ROLES.join(", ")}.`);
      return { person_id: people.id(m[1]), role };
    }),
    plans: list(get.plans).map((title) => ({ plan_id: plans.id(title) })),
    tags: list(get.tags),
  };
}

/**
 * The people (or locations, or plans) named in the file, once each,
 * ignoring capitals, with an id to link ties to them by.
 */
class Names {
  /** @param {string} prefix */
  constructor(prefix) {
    this.prefix = prefix;
    /** @type {Map<string, { id: string, name: string }>} */
    this.byKey = new Map();
  }

  /** @param {string} name */
  id(name) {
    const key = tagKey(name);
    let entry = this.byKey.get(key);
    if (!entry) {
      entry = { id: `${this.prefix}-${this.byKey.size + 1}`, name };
      this.byKey.set(key, entry);
    }
    return entry.id;
  }

  /** @param {"name" | "title"} label what the import calls the name */
  list(label) {
    return [...this.byKey.values()].map((e) => ({ id: e.id, [label]: e.name }));
  }
}

/** @param {string | undefined} cell */
function list(cell) {
  return (cell ?? "").split(";").map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {string | undefined} cell
 * @param {number} min
 * @param {number} max
 * @param {string} what
 */
function wholeNumber(cell, min, max, what) {
  if (!cell) return null;
  const n = Number(cell);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${what} should be a whole number from ${min} to ${max}.`);
  return n;
}

/**
 * The type, ignoring capitals, or null if the cell is empty.
 * @param {string | undefined} cell
 */
function tieType(cell) {
  if (!cell) return null;
  const type = cell.toLowerCase().replace(/\s+/g, " ");
  if (!TIE_TYPES.includes(type)) throw new Error(`"${cell}" isn't a type. Use one of: ${TIE_TYPES.join(", ")}.`);
  return type;
}

/** @param {string} text */
function isDate(text) {
  const m = text.match(/^(\d{4})-(\d\d)-(\d\d)$/);
  return !!m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === text;
}
