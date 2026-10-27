// Adding a shared tie, plan or workshop to my journal through the import:
// the read share and the recipient's choices as an import (import-steps.js),
// and the ids of what they chose from their own journal. Pure, so it's easy
// to test.
//
// Only what's new is sent as an item, marked `match: false` so the server
// adds it whatever its name (a "New person" named like one of mine stays
// new). People, locations and plans chosen from my journal aren't sent at
// all: their ids are filled in here (withKnown), before the import swaps
// the share's ids for mine.

import { tagKey } from "./tags.js";

/** @typedef {import("./share-item.js").SharedItem} SharedItem */
/** @typedef {import("./share-item.js").ItemKind} ItemKind */
/** @typedef {import("./share-people.js").PersonChoice} PersonChoice */
/** @typedef {import("./share-people.js").ItemChoice} ItemChoice */
/** @typedef {import("./import-steps.js").ImportDoc} ImportDoc */
/** @typedef {import("./import-steps.js").ItemsResponse} ItemsResponse */

/**
 * @typedef {{ people: PersonChoice[], location: ItemChoice | null, plans: ItemChoice[] }} ShareChoices
 * @typedef {{ people: { file_id: string, id: string }[], locations: { file_id: string, id: string }[],
 *   plans: { file_id: string, id: string }[] }} Known
 */

/** The shared plan's id in the import (a plan shared on its own). */
export const SHARED_PLAN = "shared";

/**
 * The import for a shared item and the choices made for it. Notes and the
 * like are in plain text: the page seals the whole of it before sending.
 * @param {ItemKind} kind
 * @param {SharedItem} item
 * @param {ShareChoices} choices
 * @param {string} selfId my own profile's id, for Me
 * @returns {{ doc: ImportDoc, known: Known }}
 */
export function shareToImport(kind, item, choices, selfId) {
  /** @type {ImportDoc} */
  const doc = { people: [], locations: [], plans: [], tags: [], ties: [], workshops: [] };
  /** @type {Known} */
  const known = { people: [], locations: [], plans: [] };

  if (kind === "plan") {
    doc.plans.push({
      id: SHARED_PLAN, title: item.title, plan_type: item.plan_type, tie_type: item.tie_type, est_difficulty: item.est_difficulty,
      description: item.description, notes: item.notes, album_url: item.album_url, tags: item.tags, match: false,
    });
    return { doc, known };
  }

  // Each shared person, location and plan by its place in the share.
  const personIds = item.people.map((_, i) => {
    const fileId = `person-${i}`;
    const choice = choices.people[i];
    if (choice.type === "new") doc.people.push({ id: fileId, name: choice.name.trim(), match: false });
    else known.people.push({ file_id: fileId, id: choice.type === "me" ? selfId : choice.id });
    return fileId;
  });
  /** @type {string | null} */
  let locationId = null;
  if (item.location && choices.location) {
    locationId = "location";
    if (choices.location.type === "new") {
      const { name: _name, ...place } = item.location;
      doc.locations.push({ id: locationId, name: choices.location.name.trim(), ...place, match: false });
    } else {
      known.locations.push({ file_id: locationId, id: choices.location.id });
    }
  }
  const people = (/** @type {(p: import("./share-item.js").SharedPerson) => boolean} */ which) =>
    item.people.flatMap((p, i) => (which(p) ? [{ person_id: personIds[i], role: p.role }] : []));

  if (kind === "tie") {
    const planIds = item.plans.map((_, i) => {
      const fileId = `plan-${i}`;
      const choice = choices.plans[i];
      if (choice.type === "new") doc.plans.push({ id: fileId, title: choice.name.trim(), match: false });
      else known.plans.push({ file_id: fileId, id: choice.id });
      return fileId;
    });
    doc.ties.push({
      title: item.title, tie_date: item.tie_date, tie_type: item.tie_type, duration_minutes: item.duration_minutes,
      success_rating: item.success_rating, notes: item.notes, album_url: item.album_url, location_id: locationId,
      participants: people(() => true), plans: planIds.map((id) => ({ plan_id: id })), tags: item.tags,
    });
  } else {
    doc.workshops.push({
      title: item.title, start_date: item.start_date, end_date: item.end_date, location_id: locationId,
      attendee_count: item.attendee_count, rating: item.rating, description: item.description, notes: item.notes,
      album_url: item.album_url, educators: people((p) => p.kind === "educator"), participants: people((p) => p.kind !== "educator"),
      tags: item.tags,
    });
  }
  return { doc, known };
}

/**
 * Whether the import adds any people, locations or plans (a tie or
 * workshop with a new one can't already be in my journal).
 * @param {ImportDoc} doc
 */
export const addsItems = (doc) => doc.people.length + doc.locations.length + doc.plans.length > 0;

/**
 * The items request's answer with what was chosen from my journal added,
 * for remapTies and remapWorkshops.
 * @param {Pick<ItemsResponse, "people" | "locations" | "plans">} items
 * @param {Known} known
 * @returns {ItemsResponse}
 */
export function withKnown(items, known) {
  /** @param {{ file_id: string, id: string }[]} list */
  const mine = (list) => list.map((k) => ({ ...k, name: "", matched: true }));
  return {
    people: [...items.people, ...mine(known.people)],
    locations: [...items.locations, ...mine(known.locations)],
    plans: [...items.plans, ...mine(known.plans)],
    new_tags: [],
  };
}

/**
 * One of my plans that a shared plan duplicates (the same title, ignoring
 * capitals, description and notes), or null.
 * @param {SharedItem} item
 * @param {{ id: string, title: string, description?: string | null, notes?: string | null }[]} plans mine, opened
 * @returns {string | null}
 */
export function duplicatePlan(item, plans) {
  const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => (a ?? "") === (b ?? "");
  const match = plans.find((p) => item.title !== null && tagKey(p.title) === tagKey(item.title)
    && same(p.description, item.description) && same(p.notes, item.notes));
  return match?.id ?? null;
}
