// Workshops, the Education view's, through today's API (format 1). Plain
// text in (sealed here), opened rows out. See store/index.js.

import { api } from "../../api.js";
import { open, sealOne } from "../../vault.js";

/**
 * All my workshops at once, newest first, opened (the page searches them
 * itself), each with its linked plans and ties.
 * @returns {Promise<any[]>}
 */
export async function listWorkshops() {
  return open("workshop", await api("/api/workshops"));
}

/**
 * One of my workshops, opened. Throws if it can't be loaded.
 * @param {string} id
 * @returns {Promise<Record<string, any>>}
 */
export async function getWorkshop(id) {
  const [workshop] = await open("workshop", [await api(`/api/workshops/${encodeURIComponent(id)}`)]);
  return workshop;
}

/**
 * Saves a workshop: a new one without an id. Its description, notes, album
 * and event links and cost are sealed here first.
 * @param {string | null} id
 * @param {Record<string, any>} fields plain
 * @returns {Promise<string>} its id
 */
export async function saveWorkshop(id, fields) {
  const body = await sealOne("workshop", fields);
  if (id) await api(`/api/workshops/${encodeURIComponent(id)}`, { method: "PUT", body });
  else id = /** @type {string} */ ((await api("/api/workshops", { method: "POST", body })).id);
  return id;
}

/**
 * Deletes a workshop for good, with its visuals; its ties and plans are
 * unlinked.
 * @param {string} id
 */
export async function deleteWorkshop(id) {
  await api(`/api/workshops/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * Links a tie or plan to a workshop (a tie or plan has at most one: this
 * moves it from any other).
 * @param {string} workshopId
 * @param {{ tie_id: string } | { plan_id: string }} item
 */
export async function linkToWorkshop(workshopId, item) {
  await api(`/api/workshops/${encodeURIComponent(workshopId)}/links`, { method: "POST", body: item });
}
