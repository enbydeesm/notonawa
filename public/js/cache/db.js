// The cache (format 2): an IndexedDB database on the device, one per
// account (notonawa-<user id>), opened in the crypto Worker. It holds the
// records exactly as the server does, sealed, so nothing opened is ever
// stored; the Worker opens them as they're read. Signing out deletes every
// account's (wipeCaches).
//
// Stores:
// - records: the sealed rows, by id.
// - seen: the highest version seen of each id, and whether it was deleted
//   (cache/sync-rules.js), kept for good.
// - meta: "since", the sequence number synced up to.
//
// IndexedDB ends a transaction as soon as nothing is waiting on it, so
// inside one nothing is awaited but its own requests (Safari and Firefox
// throw TransactionInactiveError otherwise): each function makes all its
// requests at once, then waits for the transaction to finish.

/** @typedef {import("./sync-rules.js").Row} Row */
/** @typedef {import("./sync-rules.js").CacheDb} CacheDb */

export const PREFIX = "notonawa-";
const VERSION = 1;

/** @param {string} userId */
export const cacheName = (userId) => `${PREFIX}${userId}`;

/**
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** @param {IDBTransaction} tx */
function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The cache's transaction was aborted."));
  });
}

/**
 * Opens (or makes) an account's cache.
 * @param {string} userId
 * @param {IDBFactory} [idb]
 * @returns {Promise<CacheDb>}
 */
export async function openCache(userId, idb = indexedDB) {
  const request = idb.open(cacheName(userId), VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "id" });
    if (!db.objectStoreNames.contains("seen")) db.createObjectStore("seen", { keyPath: "id" });
    if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
  };
  const db = await done(request);
  // Another tab deleting it (signing out) closes it here first.
  db.onversionchange = () => db.close();

  return {
    async since() {
      const tx = db.transaction("meta", "readonly");
      const got = tx.objectStore("meta").get("since");
      await finished(tx);
      return typeof got.result === "number" ? got.result : 0;
    },

    async seen(ids) {
      const tx = db.transaction("seen", "readonly");
      const store = tx.objectStore("seen");
      const gets = ids.map((id) => store.get(id));
      await finished(tx);
      return new Map(gets.filter((g) => g.result).map((g) => [g.result.id, g.result]));
    },

    async apply({ puts, removes, seen, since }) {
      const tx = db.transaction(["records", "seen", "meta"], "readwrite");
      const records = tx.objectStore("records");
      for (const row of puts) records.put(row);
      for (const id of removes) records.delete(id);
      const marks = tx.objectStore("seen");
      for (const mark of seen) marks.put(mark);
      if (since !== undefined) tx.objectStore("meta").put(since, "since");
      await finished(tx);
    },

    async rows(ids) {
      const tx = db.transaction("records", "readonly");
      const store = tx.objectStore("records");
      if (!ids) {
        const all = store.getAll();
        await finished(tx);
        return all.result;
      }
      const gets = ids.map((id) => store.get(id));
      await finished(tx);
      return gets.map((g) => g.result).filter(Boolean);
    },

    close() {
      db.close();
    },
  };
}

/**
 * Deletes every account's cache on this device (signing out, or the
 * session ending): another person may use this browser next. Where the
 * browser can't list its databases, only the one named.
 * @param {{ userId?: string | null, idb?: IDBFactory }} [options]
 */
export async function wipeCaches({ userId = null, idb = indexedDB } = {}) {
  const listed = typeof idb.databases === "function" ? await idb.databases().catch(() => null) : null;
  const names = listed
    ? listed.map((d) => d.name ?? "").filter((name) => name.startsWith(PREFIX))
    : userId ? [cacheName(userId)] : [];
  await Promise.all(names.map((name) => new Promise((resolve) => {
    const request = idb.deleteDatabase(name);
    // Blocked: a tab still has it open; it closes on versionchange, and the
    // delete goes ahead then. Either way, nothing to wait for here.
    request.onsuccess = request.onerror = request.onblocked = () => resolve(undefined);
  })));
}
