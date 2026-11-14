// An item's visuals in one order (photos and videos, drawings and poses),
// through today's API (format 1). See store/index.js.

import { api } from "../../api.js";

/**
 * Puts an item's visuals in this order. Every visual must be listed, or
 * it's refused.
 * @param {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} item
 * @param {{ kind: "media" | "drawing" | "pose", id: string }[]} order
 */
export async function setVisualOrder(item, order) {
  await api("/api/visuals/order", { method: "PUT", body: { ...item, order } });
}
