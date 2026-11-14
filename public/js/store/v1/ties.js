// Ties, through today's API (format 1). The store's other half, v2, will do
// the same over the sealed cache, so these take and give what the pages
// use: plain text in (sealed here before it's sent), opened rows out, and a
// keyword searched for here, never sent. See store/index.js.

import { api } from "../../api.js";
import { open, sealOne, searchTies, forgetSearch } from "../../vault.js";
import { readSearch, searchBody } from "../../tie-search.js";

/**
 * @typedef {import("../../tie-search.js").SearchState} SearchState
 * @typedef {{ ties: Record<string, any>[], total: number, all_total: number, page: number,
 *   page_size: number, matched: string[] | null }} FoundTies
 */

/**
 * My ties, filtered, sorted and paged. Anything left out is the Ties list's
 * default (no filters, page 1, 20 a page, newest first).
 * @param {Partial<SearchState> & { ids?: string[] }} query q: a keyword,
 *   searched for on the device in titles and notes; ids: only these ties
 * @returns {Promise<FoundTies>} the ties opened; matched: the ids the keyword
 *   found (null without one)
 */
export async function findTies(query) {
  const state = { ...readSearch(""), ...query };
  const q = state.q.trim();
  const matched = q ? await searchTies(q) : null;
  const ids = query.ids;
  const only = matched && ids ? matched.filter((id) => ids.includes(id)) : (matched ?? ids ?? null);
  const found = await api("/api/ties/search", { method: "POST", body: searchBody(state, only) });
  return { ...found, ties: await open("tie", found.ties), matched };
}

/**
 * One of my ties, opened. Throws if it can't be loaded.
 * @param {string} id
 * @returns {Promise<Record<string, any>>}
 */
export async function getTie(id) {
  const [tie] = await open("tie", [await api(`/api/ties/${encodeURIComponent(id)}`)]);
  return tie;
}

/**
 * Saves a tie: a new one without an id. Its notes and album link are sealed
 * here first.
 * @param {string | null} id
 * @param {Record<string, any>} tie the form's fields, plain
 * @returns {Promise<string>} its id
 */
export async function saveTie(id, tie) {
  const body = await sealOne("tie", tie);
  const savedId = id
    ? (await api(`/api/ties/${encodeURIComponent(id)}`, { method: "PUT", body }), id)
    : /** @type {string} */ ((await api("/api/ties", { method: "POST", body })).id);
  // The keyword search's index has this tie's old title and notes (or none).
  forgetSearch();
  return savedId;
}

/** @param {string} id */
export async function deleteTie(id) {
  await api(`/api/ties/${encodeURIComponent(id)}`, { method: "DELETE" });
  forgetSearch();
}

/**
 * The ids of the 5 active locations, people or plans most recently on a
 * tie (by tie date), for the pickers.
 * @param {"locations" | "people" | "plans"} kind
 * @returns {Promise<string[]>}
 */
export function recentOnTies(kind) {
  return api(`/api/ties/recent/${kind}`);
}
