// The order of the People and Locations lists: a search by name (and a
// person's aliases, or where a location is), and a sort
// by name (A–Z) or by when each was added. Pure, so it's easy to test;
// list-tools.js draws the search box and sort buttons.

import { normaliseKeyword } from "./search-match.js";
import { readAliases } from "./aliases.js";

/**
 * @typedef {"name" | "created"} SortKey
 * @typedef {{ sort: SortKey, descending: boolean }} ListOrder
 *   aliases: a person's opened aliases (JSON text), searched too
 *   city, state_province, country: where a location is, searched too
 * @typedef {{
 *   id: string, name?: string | null, created_at?: string, aliases?: string | null,
 *   city?: string | null, state_province?: string | null, country?: string | null,
 * }} Listed
 */

/**
 * Where a location is, as its card shows it: "Seattle, WA, USA", leaving
 * out what isn't filled in ("" if none is).
 * @param {Pick<Listed, "city" | "state_province" | "country">} place
 * @returns {string}
 */
export function placeText(place) {
  return [place.city, place.state_province, place.country].filter(Boolean).join(", ");
}

/** Newest first, to start with. @type {ListOrder} */
export const DEFAULT_ORDER = { sort: "created", descending: true };

/**
 * The order after tapping a sort button: the one already chosen flips its
 * direction; another starts A to Z, or newest first.
 * @param {ListOrder} order
 * @param {SortKey} sort
 * @returns {ListOrder}
 */
export function nextOrder(order, sort) {
  if (order.sort === sort) return { sort, descending: !order.descending };
  return { sort, descending: sort === "created" };
}

/**
 * The items whose name (or a person's alias, or a location's city, state or
 * province or country) contains the search (capitals
 * don't matter), in the chosen order. A pinned item (my own profile) comes
 * first, when it matches.
 * @template {Listed} T
 * @param {T[]} items
 * @param {string} query
 * @param {ListOrder} order
 * @param {(item: T) => boolean} [pinned]
 * @returns {T[]}
 */
export function orderList(items, query, order, pinned = () => false) {
  const keyword = normaliseKeyword(query);
  const shown = keyword === null
    ? [...items]
    : items.filter((item) => [item.name ?? "", ...readAliases(item.aliases).map((a) => a.alias), placeText(item)]
      .some((text) => text.toLocaleLowerCase().includes(keyword)));
  const direction = order.descending ? -1 : 1;
  /** @param {T} a @param {T} b */
  const byName = (a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base", numeric: true });
  /** @param {T} a @param {T} b */
  const byCreated = (a, b) => {
    const [x, y] = [a.created_at ?? "", b.created_at ?? ""];
    return x < y ? -1 : x > y ? 1 : 0;
  };
  /** @param {T} a @param {T} b */
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Added in the same second (times are to the second), A to Z either way.
  return shown.sort((a, b) => {
    const pin = Number(pinned(b)) - Number(pinned(a));
    if (pin) return pin;
    if (order.sort === "name") return direction * (byName(a, b) || byCreated(a, b) || byId(a, b));
    return direction * byCreated(a, b) || byName(a, b) || byId(a, b);
  });
}
