// The sync rules (format 2): what a page of changes from GET /api/sync does
// to the cache, and how an edit refused as stale is carried onto the newer
// version. Pure, so it's easy to test; cache/sync.js and the store apply
// them.
//
// The cache remembers the highest version it has seen of every record, and
// every id that was deleted, so the server can't serve an older copy of a
// record (its body is bound to its version, so an older pair still opens)
// or bring a deleted one back.

/**
 * A record as the server and the cache hold it: sealed.
 * @typedef {{ id: string, kind: string, version: number, seq: number, key: string, body: string }} Row
 * One change in a sync page.
 * @typedef {{ id: string, kind: string, seq: number, deleted: boolean, version: number | null, key: string | null,
 *   body: string | null }} Change
 * What the cache knows of an id: the highest version seen, and whether it was deleted.
 * @typedef {{ id: string, version: number, deleted: boolean }} Seen
 * What applying a page does.
 * @typedef {{ puts: Row[], removes: string[], seen: Seen[], refused: string[] }} PagePlan
 * The cache, as cache/db.js gives it (IndexedDB in the browser; in memory
 * in the unit tests). Typed here, so code that only uses it needn't load
 * IndexedDB's types.
 * @typedef {{
 *   since(): Promise<number>,
 *   seen(ids: string[]): Promise<Map<string, Seen>>,
 *   apply(change: { puts: Row[], removes: string[], seen: Seen[], since?: number }): Promise<void>,
 *   rows(ids?: string[]): Promise<Row[]>,
 *   close(): void,
 * }} CacheDb
 */

/**
 * What a page of changes does to the cache, given what it has seen of
 * their ids: a record is stored unless it's older than one seen, or its id
 * was deleted (refused, and the cache keeps what it has); a deletion marker
 * removes the record and remembers the id for good.
 * @param {Change[]} changes oldest first
 * @param {Map<string, Seen>} known what the cache has seen of these ids
 * @returns {PagePlan}
 */
export function planPage(changes, known) {
  const seen = new Map(known);
  /** @type {Map<string, Row>} */
  const puts = new Map();
  /** @type {Set<string>} */
  const removes = new Set();
  /** @type {Set<string>} */
  const refused = new Set();
  /** @type {Set<string>} */
  const touched = new Set();
  for (const change of changes) {
    const prior = seen.get(change.id);
    if (change.deleted) {
      puts.delete(change.id);
      removes.add(change.id);
      seen.set(change.id, { id: change.id, version: prior?.version ?? 0, deleted: true });
      touched.add(change.id);
      continue;
    }
    const version = /** @type {number} */ (change.version);
    if (prior?.deleted || (prior && version < prior.version)) {
      refused.add(change.id);
      continue;
    }
    puts.set(change.id, {
      id: change.id, kind: change.kind, version, seq: change.seq,
      key: /** @type {string} */ (change.key), body: /** @type {string} */ (change.body),
    });
    seen.set(change.id, { id: change.id, version, deleted: false });
    touched.add(change.id);
  }
  return {
    puts: [...puts.values()],
    removes: [...removes],
    seen: [...touched].map((id) => /** @type {Seen} */ (seen.get(id))),
    refused: [...refused],
  };
}

/**
 * An edit carried onto a newer version of its record: each field I changed
 * from the version I started from takes my value; every other field takes
 * the newer version's. When both changed a field, mine wins (I'm the one
 * saving now, and can see what I typed).
 * @param {Record<string, unknown>} base the body my edit started from
 * @param {Record<string, unknown>} mine my edited body
 * @param {Record<string, unknown>} theirs the newer version's body
 * @returns {Record<string, unknown>}
 */
export function mergeEdit(base, mine, theirs) {
  /** @type {Record<string, unknown>} */
  const merged = { ...theirs };
  for (const field of new Set([...Object.keys(base), ...Object.keys(mine)])) {
    if (same(base[field], mine[field])) continue;
    if (field in mine) merged[field] = mine[field];
    else delete merged[field];
  }
  return merged;
}

/**
 * Whether two JSON values are the same (object keys in any order).
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function same(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length
    && ka.every((k) => Object.hasOwn(b, k) && same(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k]));
}
