// Working out what an import will do: which people, locations and plans in
// the file are already in my journal (matched by name), what's new, and the
// rows to insert. Pure (new ids come from a function passed in), so it's easy
// to test.
//
// Matching rules (see considerations.md):
// - A name matches an existing item with the same name, ignoring capitals
//   (an exact spelling first), active items before archived ones.
// - The file's "this is me" person matches my own, whatever its name.
// - A matched item is used as it is: its details in the file aren't imported,
//   so an import never changes what's already there.
// - Tags match as they do when saving a tie (tags/parse.js matchTags).

import { tagKey, matchTags } from "../tags/parse.js";

/** @typedef {import("./import-parse.js").ItemsInput} ItemsInput */
/** @typedef {import("./import-parse.js").TieImport} TieImport */

/**
 * @typedef {{ id: string, name: string, archived_at: string | null, is_self?: number, is_default?: number }} ExistingItem
 * @typedef {{
 *   people: ExistingItem[], locations: ExistingItem[], plans: ExistingItem[],
 *   tags: { id: string, name: string }[],
 * }} Existing
 * @typedef {{ file_id: string, name: string, id: string, matched: boolean }} ItemResult
 * @typedef {Record<string, unknown>} Row
 */

/**
 * @param {ItemsInput} items
 * @param {Existing} existing my items (plans' titles as `name`)
 * @param {() => string} newId
 */
export function planItems(items, existing, newId) {
  const mySelf = existing.people.find((p) => p.is_self);

  const people = items.people.map((p) => {
    const match = p.is_self && mySelf ? mySelf : findByName(existing.people, p.name);
    return result(p.file_id, p.name, match, newId);
  });
  const locations = items.locations.map((l) => result(l.file_id, l.name, findByName(existing.locations, l.name), newId));
  // One default location at most: the file's (its first new, unarchived
  // one), and only if I don't have one already.
  const defaultLocation = existing.locations.some((l) => l.is_default) ? null
    : items.locations.find((l, i) => l.is_default && !l.archived_at && !locations[i].matched)?.file_id ?? null;
  const plans = items.plans.map((p) => result(p.file_id, p.title, findByName(existing.plans, p.title), newId));
  const planIds = new Map(plans.map((p) => [p.file_id, p.id]));

  // New plans' tags and the file's own list of tags, matched to mine.
  const newPlans = items.plans.filter((_, i) => !plans[i].matched);
  const tags = planTags(existing.tags, [...items.tags, ...newPlans.flatMap((p) => p.tags)], newId);

  const rows = {
    people: items.people.flatMap((p, i) => people[i].matched ? [] : [{
      id: people[i].id, name: p.name, pronouns: p.pronouns, notes: p.notes,
      // Only one "this is me" per journal: if I have one, it was matched above.
      is_self: p.is_self && !mySelf ? 1 : 0,
      default_role: p.default_role,
      archived_at: p.archived_at, created_at: p.created_at, updated_at: p.updated_at,
    }]),
    profileNotes: items.people.flatMap((p, i) => people[i].matched ? [] : p.profile_notes.map((n) => ({
      id: newId(), person_id: people[i].id, ...n,
    }))),
    locations: items.locations.flatMap((l, i) => locations[i].matched ? [] : [{
      id: locations[i].id, name: l.name, notes: l.notes, maps_url: l.maps_url,
      latitude: l.latitude, longitude: l.longitude,
      is_default: l.file_id === defaultLocation ? 1 : 0,
      archived_at: l.archived_at, created_at: l.created_at, updated_at: l.updated_at,
    }]),
    // Inserted without variation_of, which is set afterwards (variations), so
    // a plan can come before the one it's a variation of.
    plans: items.plans.flatMap((p, i) => plans[i].matched ? [] : [{
      id: plans[i].id, title: p.title, stage: p.stage, plan_type: p.plan_type, description: p.description, notes: p.notes,
      est_difficulty: p.est_difficulty, version: p.version,
      archived_at: p.archived_at, created_at: p.created_at, updated_at: p.updated_at,
    }]),
    variations: items.plans.flatMap((p, i) => plans[i].matched || p.variation_of === null ? [] : [{
      id: plans[i].id, variation_of: planIds.get(p.variation_of),
    }]),
    planTags: newPlans.flatMap((p) => p.tags.map((name) => ({
      plan_id: planIds.get(p.file_id), name: tags.resolve(name),
    }))),
    tags: tags.rows,
  };

  return { people, locations, plans, newTags: tags.rows.map((t) => t.name), rows };
}

/**
 * Rows for a batch of ties, each with a new id. Links must already be my ids
 * (the page swaps the file's for the ones planItems gave).
 * @param {TieImport[]} ties
 * @param {{ id: string, name: string }[]} existingTags
 * @param {() => string} newId
 */
export function planTies(ties, existingTags, newId) {
  const tags = planTags(existingTags, ties.flatMap((t) => t.tags), newId);
  const ids = ties.map(() => newId());
  const tagIds = new Map([...existingTags, ...tags.rows].map((t) => [t.name, t.id]));
  return {
    newTags: tags.rows.map((t) => t.name),
    rows: {
      tags: tags.rows,
      ties: ties.map((t, i) => ({
        id: ids[i], title: t.title, tie_date: t.tie_date, tie_type: t.tie_type, notes: t.notes,
        duration_minutes: t.duration_minutes, success_rating: t.success_rating,
        location_id: t.location_id, location_deleted: t.location_deleted,
        created_at: t.created_at, updated_at: t.updated_at,
        links: linksKey(
          t.participants,
          t.plans.map((p) => p.plan_id),
          t.tags.map((name) => /** @type {string} */ (tagIds.get(tags.resolve(name)))),
        ),
      })),
      participants: ties.flatMap((t, i) => t.participants.map((p) => ({ id: newId(), tie_id: ids[i], ...p }))),
      tiePlans: ties.flatMap((t, i) => t.plans.map((p) => ({ id: newId(), tie_id: ids[i], ...p }))),
      tieTags: ties.flatMap((t, i) => t.tags.map((name) => ({ tie_id: ids[i], name: tags.resolve(name) }))),
    },
  };
}

/**
 * A tie's people (with roles), plans and tags as one text, so the import can
 * tell a duplicate tie from a different one with the same date, title and
 * notes. Each list is sorted, so the order they're listed in doesn't matter.
 * import-db.js builds the same text for ties already saved (LINKS_KEY); the
 * two must match. A deleted person or plan (null) is an empty entry.
 * @param {{ person_id: string | null, role: string }[]} participants
 * @param {(string | null)[]} planIds
 * @param {string[]} tagIds
 */
export function linksKey(participants, planIds, tagIds) {
  const list = (/** @type {string[]} */ items) => [...items].sort().join(",");
  return [
    list(participants.map((p) => `${p.person_id ?? ""}|${p.role}`)),
    list(planIds.map((id) => id ?? "")),
    list(tagIds),
  ].join(";");
}

/**
 * Splits rows into JSON arrays small enough to bind to one statement: D1
 * allows 2 MB per value, and a character can take 3 bytes.
 * @param {Row[]} rows
 * @param {number} [maxChars]
 * @returns {string[]}
 */
export function jsonChunks(rows, maxChars = 600_000) {
  const chunks = [];
  let current = [];
  let size = 2;
  for (const row of rows) {
    const text = JSON.stringify(row);
    if (current.length && size + text.length + 1 > maxChars) {
      chunks.push(`[${current.join(",")}]`);
      current = [];
      size = 2;
    }
    current.push(text);
    size += text.length + 1;
  }
  if (current.length) chunks.push(`[${current.join(",")}]`);
  return chunks;
}

/**
 * My item with this name: exact spelling first, then ignoring capitals;
 * active before archived.
 * @param {ExistingItem[]} items
 * @param {string} name
 */
export function findByName(items, name) {
  const key = tagKey(name);
  const ordered = [...items.filter((i) => !i.archived_at), ...items.filter((i) => i.archived_at)];
  return ordered.find((i) => i.name === name) ?? ordered.find((i) => tagKey(i.name) === key);
}

/**
 * @param {string} fileId
 * @param {string} name
 * @param {ExistingItem | undefined} match
 * @param {() => string} newId
 * @returns {ItemResult}
 */
function result(fileId, name, match, newId) {
  return match
    ? { file_id: fileId, name, id: match.id, matched: true }
    : { file_id: fileId, name, id: newId(), matched: false };
}

/**
 * Matches tag names to mine; the rest become new tags.
 * @param {{ id: string, name: string }[]} existing
 * @param {string[]} names may repeat, in any capitals
 * @param {() => string} newId
 */
function planTags(existing, names, newId) {
  // Kept once, the first spelling, as parseTagNames does.
  const firsts = new Map();
  for (const name of names) if (!firsts.has(tagKey(name))) firsts.set(tagKey(name), name);
  const unique = [...firsts.values()];
  const matched = matchTags(existing, unique);
  const byKey = new Map(matched.map((t) => [tagKey(t.name), t.name]));
  return {
    rows: matched.filter((t) => t.isNew).map((t) => ({ id: newId(), name: t.name })),
    /** The stored spelling of a tag name. @param {string} name */
    resolve: (name) => /** @type {string} */ (byKey.get(tagKey(name))),
  };
}
