// The photos and videos in an import: taken off the file's ties, plans and workshops before
// anything is sent (their captions are plain text in the file, and the
// server never sees a caption unsealed), then uploaded one by one once the
// journal's part is saved. Pure, so it's easy to test.
//
// A tie or workshop skipped as a duplicate, or a plan matched by name, gets the file's
// photos only if it has none yet: a failed import can be run again to
// finish, without making copies.

/**
 * A photo or video listed in an export: `file` is its path inside the zip.
 * @typedef {{ file: string, kind: "photo" | "video", caption: string | null, position: number }} PhotoEntry
 */

/**
 * The file without its photo lists, and those lists: ties' and workshops'
 * by position, plans' by the file's plan id.
 * @template {{ ties: any[], plans: any[], workshops?: any[] }} T
 * @param {T} doc as readExport gives it
 * @returns {{
 *   doc: T, ties: Map<number, PhotoEntry[]>, plans: Map<string, PhotoEntry[]>,
 *   workshops: Map<number, PhotoEntry[]>, count: number,
 * }}
 */
export function takePhotos(doc) {
  /** @type {Map<number, PhotoEntry[]>} */
  const ties = new Map();
  /** @type {Map<string, PhotoEntry[]>} */
  const plans = new Map();
  let count = 0;
  /** @param {any} record */
  const without = (record) => {
    if (!record || typeof record !== "object" || !("photos" in record)) return record;
    const { photos: _photos, ...rest } = record;
    return rest;
  };
  doc.ties.forEach((tie, i) => {
    const entries = readEntries(tie?.photos);
    if (entries.length) ties.set(i, entries);
    count += entries.length;
  });
  /** @type {Map<number, PhotoEntry[]>} */
  const workshops = new Map();
  (doc.workshops ?? []).forEach((workshop, i) => {
    const entries = readEntries(workshop?.photos);
    if (entries.length) workshops.set(i, entries);
    count += entries.length;
  });
  for (const plan of doc.plans) {
    const entries = readEntries(plan?.photos);
    if (entries.length && plan?.id != null) plans.set(String(plan.id), entries);
    count += entries.length;
  }
  const rest = { ...doc, ties: doc.ties.map(without), plans: doc.plans.map(without) };
  if (doc.workshops) rest.workshops = doc.workshops.map(without);
  return { doc: rest, ties, plans, workshops, count };
}

/**
 * A photo list's usable entries (photos and videos with a file; older
 * exports don't say the kind of a photo), first to last.
 * @param {unknown} list
 * @returns {PhotoEntry[]}
 */
function readEntries(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p.file === "string" && p.file !== "" && [undefined, "photo", "video"].includes(p.kind))
    .map((p, i) => ({
      file: p.file,
      kind: p.kind === "video" ? /** @type {const} */ ("video") : /** @type {const} */ ("photo"),
      caption: typeof p.caption === "string" && p.caption.trim() !== "" ? p.caption : null,
      position: Number.isFinite(p.position) ? p.position : i,
    }))
    .sort((a, b) => a.position - b.position);
}

/**
 * A photo's or video's type from its name in the zip (what the file
 * picker would say).
 * @param {string} name
 */
export function typeFromName(name) {
  if (/\.mp4$/i.test(name)) return "video/mp4";
  if (/\.mov$/i.test(name)) return "video/quicktime";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  return "";
}

/**
 * The journal file inside an export's zip: notonawa.json, or failing
 * that the only .json file in it.
 * @param {Iterable<string>} names
 * @returns {string | null}
 */
export function journalEntry(names) {
  const all = [...names];
  if (all.includes("notonawa.json")) return "notonawa.json";
  const json = all.filter((n) => /\.json$/i.test(n) && !n.split("/").pop()?.startsWith("."));
  return json.length === 1 ? json[0] : null;
}
