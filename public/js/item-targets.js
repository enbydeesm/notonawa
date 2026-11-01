// Loading the ties, plans and workshops something can be put on, for
// "Copy to…" (drawing-copy.js) and the poser's "Add pose to…"
// (add-to-picker.js). Ties are searched as on the Ties page (a keyword is
// searched for on the device, and only the matching ids are sent), newest
// first; plans (not archived) and workshops are all loaded at once, and
// searched by title on the page (add-to-choices.js).

import { api } from "./api.js";
import { formatDate } from "./format.js";
import { searchTies } from "./vault.js";
import { SHOWN } from "./add-to-choices.js";

/** @typedef {import("./add-to-choices.js").Target} Target */

/**
 * Ties: the newest, or the ones a keyword finds (in their titles or notes).
 * @param {string} query
 * @returns {Promise<{ targets: Target[], matched: Set<string> | null }>}
 *   matched: the ids the keyword found (null without one)
 */
export async function loadTies(query) {
  const q = query.trim();
  const matchIds = q ? await searchTies(q) : null;
  const { ties } = await api("/api/ties/search", {
    method: "POST", body: { match_ids: matchIds, page: 1, page_size: SHOWN, sort: "newest" },
  });
  return {
    targets: ties.map((/** @type {any} */ t) => ({
      kind: /** @type {const} */ ("tie"), id: t.id, title: t.title || "Untitled tie", meta: formatDate(t.tie_date),
      recent: t.updated_at ?? t.created_at ?? "",
    })),
    matched: matchIds ? new Set(matchIds) : null,
  };
}

/**
 * Every plan not archived.
 * @returns {Promise<Target[]>}
 */
export async function loadPlans() {
  return (await api("/api/plans?archived=false")).map((/** @type {any} */ p) => ({
    kind: /** @type {const} */ ("plan"), id: p.id, title: p.title, meta: "", recent: p.updated_at ?? "",
  }));
}

/**
 * Every workshop.
 * @returns {Promise<Target[]>}
 */
export async function loadWorkshops() {
  return (await api("/api/workshops")).map((/** @type {any} */ w) => ({
    kind: /** @type {const} */ ("workshop"), id: w.id, title: w.title, meta: formatDate(w.start_date), recent: w.updated_at ?? "",
  }));
}
