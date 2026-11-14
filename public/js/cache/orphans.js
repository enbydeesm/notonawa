// Files no record lists (format 2): a photo or video uploaded whose record
// was never saved (the save failed, or the tab closed between the two), or
// one removed from its record whose file delete didn't go through. The
// device finds them, as only it can read the records. A file newer than a
// day is left alone: its record may still be on its way, from this device
// or another. Pure.

const GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * The ids of my files that no record lists.
 * @param {{ id: string, created_at: string }[]} files GET /api/files
 * @param {Record<string, any>[]} bodies every record's body
 * @param {number} now
 * @returns {string[]}
 */
export function orphanFiles(files, bodies, now) {
  /** @type {Set<string>} */
  const listed = new Set();
  for (const body of bodies) {
    for (const v of Array.isArray(body?.visuals) ? body.visuals : []) if (v?.kind === "file") listed.add(v.id);
    if (typeof body?.picture === "string") listed.add(body.picture);
  }
  return files
    .filter((f) => !listed.has(f.id) && now - Date.parse(f.created_at) > GRACE_MS)
    .map((f) => f.id);
}
