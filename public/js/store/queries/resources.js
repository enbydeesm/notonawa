// People and locations as the pages have them (format 2): the rows format
// 1's API gives (GET /api/people|locations, src/resources/), made from the
// records in memory, filtered by archived and in the same order. Pure.

/**
 * @typedef {{ kind: string, id: string, body: Record<string, any> | null }} Entry
 * @typedef {"false" | "true" | "all" | boolean} Archived
 */

/** @param {boolean | undefined} value */
const bit = (value) => (value ? 1 : 0);

/**
 * A person as the People page and pickers have them.
 * @param {Entry} entry
 */
export function personRow({ id, body }) {
  const b = body ?? {};
  return {
    id,
    name: b.name ?? "",
    pronouns: b.pronouns ?? null,
    notes: b.notes ?? null,
    is_self: bit(b.is_self),
    default_role: b.default_role ?? null,
    is_educator: bit(b.is_educator),
    based_in: b.based_in ?? null,
    // As format 1 has it once opened: JSON text (aliases.js reads it).
    aliases: Array.isArray(b.aliases) && b.aliases.length ? JSON.stringify(b.aliases) : null,
    about: b.about ?? null,
    about_shared_on: b.about_shared_on ?? null,
    // Connections come with contacts (phase 6).
    connection_id: null,
    archived_at: b.archived_at ?? null,
    created_at: b.created_at ?? null,
    updated_at: b.updated_at ?? null,
  };
}

/**
 * A location as the Locations page and pickers have them.
 * @param {Entry} entry
 */
export function locationRow({ id, body }) {
  const b = body ?? {};
  return {
    id,
    name: b.name ?? "",
    notes: b.notes ?? null,
    maps_url: b.maps_url ?? null,
    city: b.city ?? null,
    state_province: b.state_province ?? null,
    country: b.country ?? null,
    latitude: b.latitude ?? null,
    longitude: b.longitude ?? null,
    is_default: bit(b.is_default),
    archived_at: b.archived_at ?? null,
    created_at: b.created_at ?? null,
    updated_at: b.updated_at ?? null,
  };
}

/**
 * Whether a row passes the archived filter: active ones (false), archived
 * ones (true) or both (all).
 * @param {{ archived_at: string | null }} row
 * @param {Archived} archived
 */
export function passesArchived(row, archived) {
  const value = String(archived);
  if (value === "all") return true;
  if (value === "true") return row.archived_at !== null;
  if (value === "false") return row.archived_at === null;
  throw new Error("Say which items to list: archived=false (active), archived=true or archived=all.");
}

/**
 * Compares names as SQLite's COLLATE NOCASE does (ASCII letters only).
 * @param {string} a
 * @param {string} b
 */
export function nocase(a, b) {
  const x = a.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const y = b.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * My people, as GET /api/people lists them: "Me" first, then by name.
 * @param {Entry[]} entries person records
 * @param {Archived} archived
 */
export function listPeople(entries, archived) {
  return entries.map(personRow).filter((r) => passesArchived(r, archived))
    .sort((a, b) => b.is_self - a.is_self || nocase(a.name, b.name));
}

/**
 * My locations, as GET /api/locations lists them: by name.
 * @param {Entry[]} entries location records
 * @param {Archived} archived
 */
export function listLocations(entries, archived) {
  return entries.map(locationRow).filter((r) => passesArchived(r, archived)).sort((a, b) => nocase(a.name, b.name));
}
