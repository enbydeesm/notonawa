// Plans, people and locations, through today's API (format 1): the three
// share one set of routes (src/resources/), so one set of functions here,
// by kind. Plain text in (sealed here), opened rows out. See store/index.js.

import { api } from "../../api.js";
import { open, sealOne, forgetSearch } from "../../vault.js";

/**
 * @typedef {"plans" | "people" | "locations"} ResourceKind
 * @typedef {"false" | "true" | "all" | boolean} Archived active ones (false),
 *   archived ones (true) or both
 */

/** Each kind's record kind for sealing and opening. */
const RECORD = /** @type {const} */ ({ plans: "plan", people: "person", locations: "location" });

/**
 * My plans, people or locations, opened: rows as the API gives them
 * (typed per kind once records/schema.js exists).
 * @param {ResourceKind} kind
 * @param {Archived} archived
 * @returns {Promise<any[]>}
 */
export async function listItems(kind, archived) {
  return open(RECORD[kind], await api(`/api/${kind}?archived=${archived}`));
}

/**
 * Saves a plan, person or location: a new one without an id. Its notes are
 * sealed here first.
 * @param {ResourceKind} kind
 * @param {string | null} id
 * @param {Record<string, any>} fields plain; archive_now: true adds a new
 *   one already archived (a one-off location)
 * @returns {Promise<string>} its id
 */
export async function saveItem(kind, id, fields) {
  const body = await sealOne(RECORD[kind], fields);
  if (id) await api(`/api/${kind}/${encodeURIComponent(id)}`, { method: "PUT", body });
  else id = /** @type {string} */ ((await api(`/api/${kind}`, { method: "POST", body })).id);
  // A plan's title is in the keyword search's index (its linked ties').
  if (kind === "plans") forgetSearch();
  return id;
}

/**
 * @param {ResourceKind} kind
 * @param {string} id
 */
export async function archiveItem(kind, id) {
  await api(`/api/${kind}/${encodeURIComponent(id)}/archive`, { method: "POST" });
  if (kind === "plans") forgetSearch();
}

/**
 * @param {ResourceKind} kind
 * @param {string} id
 */
export async function restoreItem(kind, id) {
  await api(`/api/${kind}/${encodeURIComponent(id)}/restore`, { method: "POST" });
  if (kind === "plans") forgetSearch();
}

/**
 * Deletes a person or location for good: the ties and workshops they were
 * on show "(… deleted)".
 * @param {"people" | "locations"} kind
 * @param {string} id
 */
export async function deleteItem(kind, id) {
  await api(`/api/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * Deletes a plan for good. linkedTies: "remove" takes it off its ties too;
 * "keep" leaves them showing "(plan deleted)".
 * @param {string} id
 * @param {"remove" | "keep"} linkedTies
 */
export async function deletePlan(id, linkedTies) {
  if (linkedTies !== "remove" && linkedTies !== "keep") throw new Error("Say what to do with the plan's linked ties.");
  await api(`/api/plans/${encodeURIComponent(id)}?linked_ties=${linkedTies}`, { method: "DELETE" });
  forgetSearch();
}

/**
 * A Google Maps link's coordinates, worked out by the server (which follows
 * a short link's redirects); null when it has none.
 * @param {string} url
 * @returns {Promise<{ latitude: number | null, longitude: number | null }>}
 */
export function mapLinkCoords(url) {
  return api("/api/locations/coords", { method: "POST", body: { url } });
}
