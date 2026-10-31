// The poses in an import: taken off the file's ties, plans and workshops
// before anything is sent (their captions are plain text in the file, and
// the server never sees a caption unsealed), then saved one by one once the
// journal's part is saved, as drawings are (import-drawings.js). Pure, so
// it's easy to test.
//
// A tie or workshop skipped as a duplicate, or a plan matched by name, gets
// the file's poses only if it has none yet: a failed import can be run
// again to finish, without making copies.

import { jointsInRange } from "./figure-rig.js";

/**
 * A pose listed in an export: its data (checked by the server when
 * saved), caption and place.
 * @typedef {{ data: import("./pose-format.js").Pose, caption: string | null, position: number }} PoseEntry
 */

/**
 * The file without its pose lists, and those lists: ties' and workshops'
 * by position, plans' by the file's plan id.
 * @template {{ ties: any[], plans: any[], workshops?: any[] }} T
 * @param {T} doc as readExport gives it
 * @returns {{
 *   doc: T, ties: Map<number, PoseEntry[]>, plans: Map<string, PoseEntry[]>,
 *   workshops: Map<number, PoseEntry[]>, count: number,
 * }}
 */
export function takePoses(doc) {
  let count = 0;
  /** @param {any} record */
  const without = (record) => {
    if (!record || typeof record !== "object" || !("poses" in record)) return record;
    const { poses: _poses, ...rest } = record;
    return rest;
  };
  /** @param {any[]} list */
  const byPosition = (list) => {
    /** @type {Map<number, PoseEntry[]>} */
    const map = new Map();
    list.forEach((record, i) => {
      const entries = readEntries(record?.poses);
      if (entries.length) map.set(i, entries);
      count += entries.length;
    });
    return map;
  };
  const ties = byPosition(doc.ties);
  const workshops = byPosition(doc.workshops ?? []);
  /** @type {Map<string, PoseEntry[]>} */
  const plans = new Map();
  for (const plan of doc.plans) {
    const entries = readEntries(plan?.poses);
    if (entries.length && plan?.id != null) plans.set(String(plan.id), entries);
    count += entries.length;
  }
  const rest = { ...doc, ties: doc.ties.map(without), plans: doc.plans.map(without) };
  if (doc.workshops) rest.workshops = doc.workshops.map(without);
  return { doc: rest, ties, plans, workshops, count };
}

/**
 * A pose list's entries that have a pose in them, first to last.
 * @param {unknown} list
 * @returns {PoseEntry[]}
 */
function readEntries(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((d) => d && typeof d.data === "object" && d.data !== null && typeof d.data.joints === "object")
    .map((d, i) => ({
      // One exported before the joints' limits changed is brought within them.
      data: jointsInRange(d.data),
      caption: typeof d.caption === "string" && d.caption.trim() !== "" ? d.caption : null,
      position: Number.isFinite(d.position) ? d.position : i,
    }))
    .sort((a, b) => a.position - b.position);
}
