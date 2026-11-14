// Ties over the journal in memory (format 2): the same functions as
// v1/ties.js, so the pages don't change. The search, the keyword search
// (in memory, where the notes already are), the recent pickers and the
// rows are store/queries/ties.js's; a tie's record from its form is
// records/edits.js's.

import { records, record, byId, save } from "./journal.js";
import { readSearch, searchBody } from "../../tie-search.js";
import { matchingTies } from "../../search-match.js";
import { newId } from "../../records/ids.js";
import { stamp } from "../../records/parse.js";
import { tieBody, itemDeletes } from "../../records/edits.js";
import { linkTags } from "../../records/tags.js";
import { readTieFilters, findTiesIn, tieRow, searchIndex, recentOn } from "../queries/ties.js";

/** @typedef {import("../v1/ties.js").FoundTies} FoundTies */

/**
 * My ties, filtered, sorted and paged, as v1's findTies.
 * @param {Partial<import("../../tie-search.js").SearchState> & { ids?: string[] }} query
 * @returns {Promise<FoundTies>}
 */
export async function findTies(query) {
  const state = { ...readSearch(""), ...query };
  const ties = records("tie");
  const journal = byId();
  const q = state.q.trim();
  const matched = q ? matchingTies(searchIndex(ties, journal), q) : null;
  const ids = query.ids;
  const only = matched && ids ? matched.filter((id) => ids.includes(id)) : (matched ?? ids ?? null);
  return { ...findTiesIn(ties, journal, readTieFilters(searchBody(state, only))), matched };
}

/**
 * One of my ties, as the Ties list has it. Throws if there's none.
 * @param {string} id
 * @returns {Promise<Record<string, any>>}
 */
export async function getTie(id) {
  const tie = record(id);
  if (!tie || tie.kind !== "tie") throw new Error("Not found");
  return tieRow(tie, byId());
}

/**
 * Saves a tie: a new one without an id. New tags are made in the same save.
 * @param {string | null} id
 * @param {Record<string, any>} fields the form's, plain
 * @returns {Promise<string>} its id
 */
export async function saveTie(id, fields) {
  const prev = id ? record(id) : null;
  if (id && prev?.kind !== "tie") throw new Error("Not found");
  const now = stamp();
  const tieId = id ?? newId();
  const tags = linkTags(records("tag"), fields.tags, now);
  const has = (/** @type {string} */ kind, /** @type {string} */ linkId) => {
    const entry = record(linkId);
    return entry?.kind === kind ? entry : null;
  };
  const body = tieBody(fields, prev?.body ?? null, { tagIds: tags.ids, has, now });
  await save({ writes: [...tags.writes, { kind: "tie", id: tieId, body, from: prev?.body ?? undefined }] });
  return tieId;
}

/**
 * Deletes a tie for good, with its drawings and poses, freeing its photos'
 * and videos' files (its people, plans and tags stay).
 * @param {string} id
 */
export async function deleteTie(id) {
  const tie = record(id);
  if (tie?.kind !== "tie") throw new Error("Not found");
  await save({ deletes: itemDeletes(tie).filter((d) => d.id === id || record(d.id)) });
}

/**
 * The ids of the 5 active locations, people or plans most recently on a tie.
 * @param {"locations" | "people" | "plans"} kind
 * @returns {Promise<string[]>}
 */
export async function recentOnTies(kind) {
  return recentOn(kind, records("tie"), byId());
}
