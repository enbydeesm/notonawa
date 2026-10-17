// The order of the People and Locations lists: a search by name, and a sort
// by name (A–Z) or by when each was added. Pure, so it's easy to test;
// list-tools.js draws the search box and sort buttons.

import { normaliseKeyword } from "./search-match.js";

/**
 * @typedef {"name" | "created"} SortKey
 * @typedef {{ sort: SortKey, descending: boolean }} ListOrder
 * @typedef {{ id: string, name?: string | null, created_at?: string }} Listed
 */

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
 * The items whose name contains the search (capitals don't matter), in the
 * chosen order. A pinned item (my own profile) comes first, when it matches.
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
    : items.filter((item) => (item.name ?? "").toLocaleLowerCase().includes(keyword));
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
