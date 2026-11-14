// Connections between accounts, through today's API (format 1). They become
// contact records kept in my own sealed data later. See store/index.js.

import { api } from "../../api.js";
import { open, sealOne } from "../../vault.js";
import { convertConnections } from "../../journal-fields.js";

/**
 * My connections, newest first, their names opened.
 * @returns {Promise<import("../../connection-text.js").Connection[]>}
 */
export async function listConnections() {
  return convertConnections(await api("/api/connections"), (kind, records) => open(kind, records));
}

/**
 * Accepts an invite's offer to connect, putting it on one of my people.
 * @param {{ offer: string, personId: string, name: string }} accept name:
 *   the inviter's, sealed here as my side's label
 */
export async function acceptConnection({ offer, personId, name }) {
  const { label } = await sealOne("connection", { label: name });
  await api("/api/connections", { method: "POST", body: { offer, person_id: personId, label } });
}

/**
 * Puts a connection on one of my people, taking it off any other.
 * @param {string} id my side of it
 * @param {string} personId
 */
export async function setConnectionPerson(id, personId) {
  await api(`/api/connections/${encodeURIComponent(id)}/person`, { method: "PUT", body: { person_id: personId } });
}

/**
 * The inviter's Not now.
 * @param {string} id
 */
export async function markConnectionAnswered(id) {
  await api(`/api/connections/${encodeURIComponent(id)}/answered`, { method: "POST", body: {} });
}

/**
 * Removes a connection for both accounts.
 * @param {string} id my side of it
 * @param {"remove" | "keep"} about remove: clears my About from their card
 */
export async function deleteConnection(id, about) {
  await api(`/api/connections/${encodeURIComponent(id)}?about=${about}`, { method: "DELETE" });
}
