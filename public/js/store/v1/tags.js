// Tags, shared by ties, plans and workshops, through today's API (format
// 1). See store/index.js.

import { api } from "../../api.js";

/**
 * @typedef {{ id: string, name: string, tie_count: number, plan_count: number, workshop_count: number }} Tag
 */

/**
 * My tags, most recently used on a tie first, with how many ties, plans and
 * workshops each is on.
 * @returns {Promise<Tag[]>}
 */
export function listTags() {
  return api("/api/tags");
}

/**
 * Deletes a tag for good, from every tie, plan and workshop it's on.
 * @param {string} id
 */
export async function deleteTag(id) {
  await api(`/api/tags/${encodeURIComponent(id)}`, { method: "DELETE" });
}
