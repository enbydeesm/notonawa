// The drawings in an import: taken off the file's ties, plans and workshops
// before anything is sent (their captions are plain text in the file, and
// the server never sees a caption unsealed), then saved one by one once the
// journal's part is saved, as photos are (import-photos.js). Pure, so it's
// easy to test.
//
// A tie or workshop skipped as a duplicate, or a plan matched by name, gets
// the file's drawings only if it has none yet: a failed import can be run
// again to finish, without making copies.

/**
 * A drawing listed in an export: its lines (checked by the server when
 * saved), caption and place.
 * @typedef {{ data: import("./drawing-format.js").Drawing, caption: string | null, position: number }} DrawingEntry
 */

/**
 * The file without its drawing lists, and those lists: ties' and
 * workshops' by position, plans' by the file's plan id.
 * @template {{ ties: any[], plans: any[], workshops?: any[] }} T
 * @param {T} doc as readExport gives it
 * @returns {{
 *   doc: T, ties: Map<number, DrawingEntry[]>, plans: Map<string, DrawingEntry[]>,
 *   workshops: Map<number, DrawingEntry[]>, count: number,
 * }}
 */
export function takeDrawings(doc) {
  let count = 0;
  /** @param {any} record */
  const without = (record) => {
    if (!record || typeof record !== "object" || !("drawings" in record)) return record;
    const { drawings: _drawings, ...rest } = record;
    return rest;
  };
  /** @param {any[]} list */
  const byPosition = (list) => {
    /** @type {Map<number, DrawingEntry[]>} */
    const map = new Map();
    list.forEach((record, i) => {
      const entries = readEntries(record?.drawings);
      if (entries.length) map.set(i, entries);
      count += entries.length;
    });
    return map;
  };
  const ties = byPosition(doc.ties);
  const workshops = byPosition(doc.workshops ?? []);
  /** @type {Map<string, DrawingEntry[]>} */
  const plans = new Map();
  for (const plan of doc.plans) {
    const entries = readEntries(plan?.drawings);
    if (entries.length && plan?.id != null) plans.set(String(plan.id), entries);
    count += entries.length;
  }
  const rest = { ...doc, ties: doc.ties.map(without), plans: doc.plans.map(without) };
  if (doc.workshops) rest.workshops = doc.workshops.map(without);
  return { doc: rest, ties, plans, workshops, count };
}

/**
 * A drawing list's entries that have lines, first to last.
 * @param {unknown} list
 * @returns {DrawingEntry[]}
 */
function readEntries(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((d) => d && typeof d.data === "object" && d.data !== null && Array.isArray(d.data.strokes))
    .map((d, i) => ({
      data: d.data,
      caption: typeof d.caption === "string" && d.caption.trim() !== "" ? d.caption : null,
      position: Number.isFinite(d.position) ? d.position : i,
    }))
    .sort((a, b) => a.position - b.position);
}
