// A cache (public/js/cache/db.js's CacheDb) kept in memory, for unit tests
// in Node, which has no IndexedDB. The walkthrough checks the real one.

/** @typedef {import("../public/js/cache/sync-rules.js").CacheDb} CacheDb */

/** @returns {CacheDb & { data: { records: Map<string, any>, seen: Map<string, any>, since: number } }} */
export function memoryCache() {
  const data = { records: new Map(), seen: new Map(), since: 0 };
  return {
    data,
    async since() { return data.since; },
    async seen(ids) { return new Map(ids.filter((id) => data.seen.has(id)).map((id) => [id, data.seen.get(id)])); },
    async apply({ puts, removes, seen, since }) {
      for (const row of puts) data.records.set(row.id, structuredClone(row));
      for (const id of removes) data.records.delete(id);
      for (const mark of seen) data.seen.set(mark.id, { ...mark });
      if (since !== undefined) data.since = since;
    },
    async rows(ids) {
      return ids ? ids.filter((id) => data.records.has(id)).map((id) => structuredClone(data.records.get(id))) : [...data.records.values()];
    },
    close() {},
  };
}
