// Syncing the cache (format 2): asks GET /api/sync for everything since
// the last sequence number synced, page by page, and applies each page to
// the cache by the sync rules. Runs in the crypto Worker, which fetches
// the pages itself; what it needs is passed in, so it can be tested.
//
// Only one tab syncs or saves at a time (exclusive: the browser's Web
// Locks, one lock per account), so two tabs never apply pages over each
// other.

import { planPage } from "./sync-rules.js";

/** @typedef {import("./sync-rules.js").CacheDb} CacheDb */
/** @typedef {{ changes: import("./sync-rules.js").Change[], next: number, done: boolean }} SyncPage */
/** @typedef {<T>(fn: () => Promise<T>) => Promise<T>} Exclusive */

/**
 * Runs a function alone, across tabs, where the browser has Web Locks;
 * otherwise just runs it.
 * @param {string} name
 * @returns {Exclusive}
 */
export function webLock(name) {
  // Typed loosely: the Worker's checks (tsconfig) know no Web Locks.
  const locks = /** @type {any} */ (globalThis).navigator?.locks;
  return (fn) => (locks ? locks.request(name, fn) : fn());
}

/**
 * Brings the cache up to date.
 * @param {{ db: CacheDb, fetchPage: (since: number) => Promise<SyncPage>, exclusive?: Exclusive }} args
 * @returns {Promise<{ changed: string[], removed: string[], refused: string[] }>} the ids whose records
 *   changed or were deleted, and those refused (an older copy, or a deleted id back)
 */
export async function syncCache({ db, fetchPage, exclusive = (fn) => fn() }) {
  return exclusive(async () => {
    let since = await db.since();
    /** @type {Set<string>} */
    const changed = new Set();
    /** @type {Set<string>} */
    const removed = new Set();
    /** @type {Set<string>} */
    const refused = new Set();
    for (;;) {
      const page = await fetchPage(since);
      const plan = planPage(page.changes, await db.seen(page.changes.map((c) => c.id)));
      // A page that doesn't move on would loop for ever: keep what's there.
      const next = Math.max(since, page.next);
      await db.apply({ ...plan, since: next });
      for (const row of plan.puts) {
        changed.add(row.id);
        removed.delete(row.id);
      }
      for (const id of plan.removes) {
        removed.add(id);
        changed.delete(id);
      }
      for (const id of plan.refused) refused.add(id);
      if (page.done || next === since) break;
      since = next;
    }
    return { changed: [...changed], removed: [...removed], refused: [...refused] };
  });
}
