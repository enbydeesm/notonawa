// An item's visuals (photos and videos, drawings and poses) share one order:
// parsing a new one. Pure, so it's easy to test.

import { BadInput } from "../http.js";
import { MAX_PER_ITEM as MAX_MEDIA, parseMediaId } from "../media/parse.js";
import { MAX_PER_ITEM as MAX_DRAWINGS, parseDrawingId } from "../drawings/parse.js";
import { MAX_PER_ITEM as MAX_POSES, parsePoseId } from "../poses/parse.js";

/** Each kind of visual, its table, and its id's parser. */
export const VISUAL_KINDS = /** @type {const} */ ({
  media: { table: "media", parseId: parseMediaId },
  drawing: { table: "drawings", parseId: parseDrawingId },
  pose: { table: "poses", parseId: parsePoseId },
});

/** The most visuals one item can have, all kinds together. */
export const MAX_VISUALS = MAX_MEDIA + MAX_DRAWINGS + MAX_POSES;

/** @typedef {{ kind: keyof typeof VISUAL_KINDS, id: string }} VisualRef */

/**
 * A new order for an item's visuals: every one of them, once each, first to
 * last, each as { kind, id }.
 * @param {unknown} value
 * @returns {VisualRef[]}
 */
export function parseVisualOrder(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_VISUALS) throw new BadInput("Expected the visuals in order.");
  const order = value.map((v) => {
    const kind = v?.kind;
    if (!Object.hasOwn(VISUAL_KINDS, kind)) throw new BadInput("That isn't a kind of visual.");
    return { kind: /** @type {VisualRef["kind"]} */ (kind), id: VISUAL_KINDS[/** @type {VisualRef["kind"]} */ (kind)].parseId(v.id) };
  });
  if (new Set(order.map((v) => v.id)).size !== order.length) throw new BadInput("Each visual can only be listed once.");
  return order;
}
