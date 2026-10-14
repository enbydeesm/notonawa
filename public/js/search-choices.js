// What the tie form's search pickers (location, people, plans) list and
// offer to add. Pure (no DOM), so it's easy to test.

import { nameMatches, sortByName } from "./tie-search.js";

/** How many a picker shows before anything is typed (besides me). */
export const RECENT_COUNT = 5;

/**
 * name is what's searched and matched (a plan's title); label is what's
 * shown, if different (e.g. "Me (you)"). isSelf marks my own profile;
 * defaultRole is a person's usual role.
 * @typedef {{
 *   id: string, name: string, label?: string, created_at: string,
 *   isSelf?: boolean, defaultRole?: string,
 * }} PickerItem
 */

/**
 * With nothing typed: the items most recently on a tie (recentIds, from the
 * API, newest first), topped up with the newest added, up to RECENT_COUNT.
 * With something typed: every item whose name contains it, ignoring
 * capitals, A–Z. Either way my own profile comes first when it's listed
 * (with nothing typed it always is, on top of the RECENT_COUNT others).
 * @param {PickerItem[]} items my active items
 * @param {string[]} recentIds
 * @param {string} query what's typed in the box
 * @returns {PickerItem[]}
 */
export function searchChoices(items, recentIds, query) {
  const me = items.find((item) => item.isSelf);
  const others = items.filter((item) => item !== me);
  const meFirst = (/** @type {PickerItem[]} */ list) => (me && list.includes(me) ? [me, ...list.filter((item) => item !== me)] : list);

  if (query.trim()) return meFirst(sortByName(items.filter((item) => nameMatches(item.name, query))));
  const rest = recentOrNewest(others, recentIds);
  return me ? [me, ...rest] : rest;
}

/**
 * @param {PickerItem[]} items
 * @param {string[]} recentIds
 */
function recentOrNewest(items, recentIds) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const recent = recentIds.map((id) => byId.get(id)).filter((item) => item !== undefined);
  const newest = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const chosen = new Set(recent);
  for (const item of newest) {
    if (chosen.size >= RECENT_COUNT) break;
    chosen.add(item);
  }
  return [...chosen].slice(0, RECENT_COUNT);
}

/**
 * What to offer for the typed text, below the list:
 * - { add: name }: it isn't one of mine, so offer to add it (tidied);
 * - { archived: name }: it's one I've archived, so point to restoring it
 *   instead of adding a second one;
 * - null: nothing typed, or it's already in the list to pick.
 * Names match ignoring capitals and extra spaces.
 * @param {PickerItem[]} active
 * @param {PickerItem[]} archived
 * @param {string} query
 * @returns {{ add: string } | { archived: string } | null}
 */
export function addOffer(active, archived, query) {
  const name = tidy(query);
  if (!name) return null;
  const key = name.toLocaleLowerCase();
  /** @param {PickerItem} item */
  const same = (item) => tidy(item.name).toLocaleLowerCase() === key;
  if (active.some(same)) return null;
  const match = archived.find(same);
  return match ? { archived: match.name } : { add: name };
}

/** @param {string} text */
function tidy(text) {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * A picker's items, shared by every row of that kind in the form (so one
 * added in one row is offered in the others).
 * @typedef {{ active: PickerItem[], archived: PickerItem[], recent: string[] }} PickerSource
 */

/**
 * Turns the API's rows (from ?archived=all) into a picker's items. Plans
 * are named by their title; my own profile is labelled "(you)".
 * @param {Record<string, any>[]} rows
 * @param {string[]} recent ids from /api/ties/recent/:type
 * @returns {PickerSource}
 */
export function pickerSource(rows, recent) {
  /** @type {PickerSource} */
  const source = { active: [], archived: [], recent };
  for (const row of rows) {
    const name = row.name ?? row.title;
    /** @type {PickerItem} */
    const item = { id: row.id, name, created_at: row.created_at };
    if (row.is_self) Object.assign(item, { label: `${name} (you)`, isSelf: true });
    if (row.default_role) item.defaultRole = row.default_role;
    (row.archived_at ? source.archived : source.active).push(item);
  }
  return source;
}
