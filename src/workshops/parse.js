// Parsing a submitted workshop. Pure, so it's easy to test.

import { BadInput } from "../http.js";
import { cleanText, toIntOrNull, toDateOrNull, encryptedText } from "../parse.js";
import { parseTagNames } from "../tags/parse.js";
import { toRoleOrNull } from "../ties/parse.js";

/** Who someone is on a workshop (migration 0018). */
export const PEOPLE_KINDS = ["educator", "participant"];
const MAX_PEOPLE = 40;
const MAX_KEPT = 40;
export const MAX_ATTENDEES = 100_000;

/**
 * @typedef {{ person_id: string, kind: string, role: string }} WorkshopPersonInput
 * @typedef {{
 *   title: string,
 *   start_date: string,
 *   end_date: string | null,
 *   location_id: string | null,
 *   attendee_count: number | null,
 *   rating: number | null,
 *   description: string | null,
 *   notes: string | null,
 *   album_url: string | null,
 *   people: WorkshopPersonInput[],
 *   tags: string[],
 * }} WorkshopInput
 */

/**
 * Body: { title, start_date, end_date, location_id, attendee_count, rating,
 *         description, notes, album_url (the last three sealed),
 *         educators: [{ person_id, role }], participants: [{ person_id, role }],
 *         tags: [name] }
 * A title and start date are required; the end date is for one lasting more
 * than a day. A person is on a workshop once: as an educator or a
 * participant, not both.
 * @param {Record<string, unknown>} body
 * @returns {WorkshopInput}
 */
export function parseWorkshopInput(body) {
  const title = cleanText(body.title);
  if (!title) throw new BadInput("Add a title.");
  if (title.length > 200) throw new BadInput("Keep the title to 200 characters.");
  const start = toDateOrNull(body.start_date);
  if (!start) throw new BadInput("Add a start date.");
  let end = toDateOrNull(body.end_date);
  if (end !== null && end < start) throw new BadInput("The end date is before the start date.");
  if (end === start) end = null; // one day: no end date

  return {
    title,
    start_date: start,
    end_date: end,
    location_id: cleanText(body.location_id),
    attendee_count: count(body.attendee_count),
    rating: toIntOrNull(body.rating, 1, 5),
    // Encrypted in the browser.
    description: encryptedText(body.description),
    notes: encryptedText(body.notes),
    album_url: encryptedText(body.album_url),
    people: parsePeople(body.educators, body.participants),
    tags: parseTagNames(body.tags),
  };
}

/** @param {unknown} value */
function count(value) {
  try {
    return toIntOrNull(value, 0, MAX_ATTENDEES);
  } catch {
    throw new BadInput("The attendee count should be a whole number, 0 or more.");
  }
}

/**
 * The educators and participants as one list, each with its kind.
 * @param {unknown} educators
 * @param {unknown} participants
 * @returns {WorkshopPersonInput[]}
 */
export function parsePeople(educators, participants) {
  const rows = [...peopleList(educators, "educator"), ...peopleList(participants, "participant")];
  if (rows.length > MAX_PEOPLE) throw new BadInput(`A workshop can have up to ${MAX_PEOPLE} people.`);
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.person_id)) {
      throw new BadInput("Someone is on the workshop twice. Each person can be an educator or a participant, not both.");
    }
    seen.add(row.person_id);
  }
  return rows;
}

/**
 * @param {unknown} value
 * @param {string} kind
 * @returns {WorkshopPersonInput[]}
 */
function peopleList(value, kind) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadInput(`The ${kind}s should be a list.`);
  return value.map((item) => {
    const personId = cleanText(item?.person_id);
    const role = toRoleOrNull(item?.role);
    if (!personId || !role) throw new BadInput(`Each ${kind} needs a person and a role.`);
    return { person_id: personId, kind, role };
  });
}

/**
 * Links on a workshop to people or a location since deleted, shown in the
 * edit form as "(… deleted)". Ones listed here are kept; the rest go.
 * people: the link rows' ids.
 * @typedef {{ people: string[], location: boolean }} KeptDeleted
 */

/**
 * Body: as parseWorkshopInput, plus keep_deleted: { people: [link id],
 * location: true|false } (optional).
 * @param {Record<string, unknown>} body
 * @returns {WorkshopInput & { keep_deleted: KeptDeleted }}
 */
export function parseWorkshopUpdate(body) {
  const workshop = parseWorkshopInput(body);
  const keep = body.keep_deleted ?? {};
  if (typeof keep !== "object" || Array.isArray(keep)) throw new BadInput("keep_deleted should be an object.");
  const k = /** @type {Record<string, unknown>} */ (keep);
  const people = k.people ?? [];
  if (!Array.isArray(people) || people.length > MAX_KEPT) throw new BadInput("keep_deleted.people should be a list.");
  return {
    ...workshop,
    keep_deleted: {
      people: [...new Set(people.map(cleanText).filter((id) => id !== null))],
      location: k.location === true,
    },
  };
}
