// What the charts say and which colors they use, apart from drawing them
// (charts.js, which needs the page). Pure, so it's easy to test.

import { roleName } from "./roles.js";

/**
 * @typedef {import("./stats.js").Segment} Segment
 * @typedef {{ key: Segment, count: number, tieIds: string[] }} Part
 */

/** The color of each part of a role-colored bar. */
export const SEGMENT_COLORS = /** @type {Record<Segment, string>} */ ({
  top: "c-yellow", bottom: "c-purple", "self tie": "c-teal", other: "c-grey",
});
/** The tie types' colors in the pie chart ("none": no type set). */
export const TYPE_COLORS = /** @type {Record<string, string>} */ ({
  suspension: "c-yellow", "partial suspension": "c-purple", floor: "c-teal", hashira: "c-coral", none: "c-grey",
});

/** "1 tie", "3 ties". @param {number} n */
export const tiesWord = (n) => (n === 1 ? "1 tie" : `${n} ties`);

/**
 * "13 ties, 7 as top, 6 as bottom" (or "3 ties, as top"): a bar's count
 * and its parts, in words. A grey part ("other") isn't spelled out: it's
 * every tie.
 * @param {{ count: number, segments?: Part[] }} bar
 */
export function describeParts(bar) {
  const parts = (bar.segments ?? []).filter((part) => part.key !== "other");
  if (!parts.length) return tiesWord(bar.count);
  if (parts.length === 1) return `${tiesWord(bar.count)}, as ${roleName(parts[0].key)}`;
  return [tiesWord(bar.count), ...parts.map((part) => `${part.count} as ${roleName(part.key)}`)].join(", ");
}

