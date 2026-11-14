// Your data's export and import, through today's API (format 1). These pass
// today's sealed shapes through as they are (the pages seal and open them,
// journal-fields.js); the encrypted cache's version builds the export and
// does the import on the device instead. See store/index.js.

import { api } from "../../api.js";

/**
 * The whole journal as GET /api/data/export gives it, notes still sealed.
 * @returns {Promise<any>}
 */
export function exportSealed() {
  return api("/api/data/export");
}

/**
 * Adds an import's people, locations and plans (preview: only says what
 * would happen).
 * @param {Record<string, unknown>} body as POST /api/data/import/items takes it
 * @returns {Promise<any>}
 */
export function importItems(body) {
  return api("/api/data/import/items", { method: "POST", body });
}

/**
 * Adds a batch of an import's ties, or with preview finds duplicates.
 * @param {Record<string, unknown>} body as POST /api/data/import/ties takes it
 * @returns {Promise<any>}
 */
export function importTies(body) {
  return api("/api/data/import/ties", { method: "POST", body });
}

/**
 * Adds a batch of an import's workshops, or with preview finds duplicates.
 * @param {Record<string, unknown>} body as POST /api/data/import/workshops takes it
 * @returns {Promise<any>}
 */
export function importWorkshops(body) {
  return api("/api/data/import/workshops", { method: "POST", body });
}
