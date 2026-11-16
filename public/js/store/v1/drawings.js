// Drawings and poses on ties, plans and workshops, through today's API
// (format 1). Both are kept the same way: their lines or numbers as plain
// JSON and a sealed caption, under /api/drawings and /api/poses. See
// store/index.js.

import { api } from "../../api.js";
import { open, sealOne } from "../../vault.js";

/**
 * @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item
 * @typedef {{ id: string, data: any, caption: string | null, unreadable?: string[], position: number, created_at: string }} Drawn
 */

/**
 * The functions for one kind.
 * @param {"drawings" | "poses"} route
 * @param {"drawing" | "pose"} record
 */
function drawn(route, record) {
  return {
    /**
     * An item's drawings or poses, captions opened.
     * @param {Item} item
     * @returns {Promise<Drawn[]>}
     */
    list: async (item) => open(record, await api(`/api/${route}?${new URLSearchParams(item)}`)),
    /**
     * Adds one, last among the item's visuals, its caption sealed first.
     * @param {Item} item
     * @param {{ data: any, caption: string | null }} entry
     * @returns {Promise<string>} its id
     */
    add: async (item, { data, caption }) => {
      const { caption: sealed } = await sealOne(record, { caption });
      return /** @type {string} */ ((await api(`/api/${route}`, { method: "POST", body: { ...item, data, caption: sealed } })).id);
    },
    /**
     * Saves new lines or numbers, or a new caption (sealed here).
     * @param {string} id
     * @param {{ data: any } | { caption: string | null }} change
     */
    update: async (id, change) => {
      const body = "caption" in change ? { caption: (await sealOne(record, { caption: change.caption })).caption } : change;
      await api(`/api/${route}/${encodeURIComponent(id)}`, { method: "PUT", body });
    },
    /** @param {string} id */
    remove: async (id) => {
      await api(`/api/${route}/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  };
}

const drawings = drawn("drawings", "drawing");
const poses = drawn("poses", "pose");

export const listDrawings = drawings.list;
export const addDrawing = drawings.add;
export const updateDrawing = drawings.update;
export const deleteDrawing = drawings.remove;
export const listPoses = poses.list;
export const addPose = poses.add;
export const updatePose = poses.update;
export const deletePose = poses.remove;
