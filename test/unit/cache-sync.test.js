// The cache kept in step with the server (public/js/cache/sync.js) and the
// crypto Worker's format 2 operations over it (vault-core.js: openCache,
// syncCache, readCache, saveRecords), against a server in memory that
// keeps the records routes' rules: versions, sequence numbers, markers.
import { describe, it, expect } from "vitest";
import { syncCache } from "../../public/js/cache/sync.js";
import { VaultCore } from "../../public/js/crypto/vault-core.js";
import { newRecoveryCode, readRecoveryCode } from "../../public/js/recovery.js";
import { memoryCache } from "../memory-cache.js";

const USER = "user-1";
const TIE = { tie_date: "2026-11-14", tie_type: "floor", title: "Futomomo" };

/** A server in memory, with GET /api/sync's and POST /api/records's rules. */
function fakeServer({ pageSize = 500 } = {}) {
  /** @type {Map<string, any>} */
  const records = new Map();
  /** @type {Map<string, any>} */
  const deleted = new Map();
  let seq = 0;
  return {
    records,
    /** @param {number} since */
    async fetchSync(since) {
      const all = [...records.values(), ...deleted.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      const changes = all.slice(0, pageSize);
      return { changes, next: changes.length ? changes[changes.length - 1].seq : since, done: all.length <= pageSize };
    },
    /** @param {any} batch */
    async postRecords(batch) {
      const stale = [
        ...batch.writes.filter((/** @type {any} */ w) => (w.base_version === 0
          ? records.has(w.id) || deleted.has(w.id) : records.get(w.id)?.version !== w.base_version)),
        ...batch.deletes.filter((/** @type {any} */ d) => records.get(d.id)?.version !== d.base_version),
      ].map((op) => op.id);
      if (stale.length) return { status: 409, body: { stale } };
      const saved = [];
      for (const w of batch.writes) {
        const row = { id: w.id, kind: w.kind, seq: ++seq, deleted: false, version: w.base_version + 1, key: w.key, body: w.body };
        records.set(w.id, row);
        saved.push({ id: w.id, version: row.version, seq: row.seq });
      }
      for (const d of batch.deletes) {
        records.delete(d.id);
        deleted.set(d.id, { id: d.id, kind: d.kind, seq: ++seq, deleted: true, version: null, key: null, body: null });
        saved.push({ id: d.id, version: null, seq });
      }
      return { status: 200, body: { saved } };
    },
  };
}

/**
 * A device: a vault with its own cache, unlocked, on the server given.
 * @param {ReturnType<typeof fakeServer>} server
 * @param {{ wrap: any, code: string } | null} [account] another device of this account
 */
async function device(server, account = null) {
  const cache = memoryCache();
  const io = { open: async () => cache, fetchSync: server.fetchSync, postRecords: server.postRecords, exclusive: () => (/** @type {any} */ fn) => fn() };
  const vault = new VaultCore(undefined, undefined, undefined, undefined, io);
  let wrap = account?.wrap;
  const code = account?.code ?? /** @type {string} */ (readRecoveryCode(newRecoveryCode()));
  if (account) await vault.unlock({ userId: USER, wrap, secret: { code } });
  else wrap = (await vault.setup({ userId: USER, code })).recovery;
  await vault.openCache();
  return { vault, cache, account: { wrap, code } };
}

describe("syncCache", () => {
  it("fetches page after page from where it got to, and says what changed", async () => {
    const server = fakeServer({ pageSize: 2 });
    const a = await device(server);
    await a.vault.saveRecords({ writes: ["t1", "t2", "t3"].map((id) => ({ kind: "tie", id, base_version: 0, body: TIE })) });
    const b = await device(server, a.account);
    const synced = await b.vault.syncCache();
    expect(synced.records.map((r) => [r.id, r.body?.title])).toEqual([["t1", "Futomomo"], ["t2", "Futomomo"], ["t3", "Futomomo"]]);
    expect(b.cache.data.since).toBe(3);
    expect((await b.vault.syncCache()).records).toEqual([]);
  });

  it("removes deleted records, and says which", async () => {
    const server = fakeServer();
    const a = await device(server);
    await a.vault.saveRecords({ writes: [{ kind: "tie", id: "t1", base_version: 0, body: TIE }] });
    const b = await device(server, a.account);
    await b.vault.syncCache();
    await a.vault.saveRecords({ deletes: [{ kind: "tie", id: "t1", base_version: 1 }] });
    expect(await b.vault.syncCache()).toMatchObject({ records: [], removed: ["t1"] });
    expect(await b.vault.readCache()).toEqual([]);
  });

  it("refuses an older copy than one it has seen", async () => {
    const cache = memoryCache();
    await cache.apply({ puts: [], removes: [], seen: [{ id: "t1", version: 4, deleted: false }] });
    const page = { changes: [{ id: "t1", kind: "tie", seq: 1, deleted: false, version: 2, key: "k", body: "b" }], next: 1, done: true };
    expect(await syncCache({ db: cache, fetchPage: async () => page })).toEqual({ changed: [], removed: [], refused: ["t1"] });
  });

  it("stops on a page that doesn't move on", async () => {
    const cache = memoryCache();
    let asked = 0;
    const result = await syncCache({ db: cache, fetchPage: async () => { asked++; return { changes: [], next: 0, done: false }; } });
    expect([result.changed, asked]).toEqual([[], 1]);
  });

  it("runs alone, through the lock it's given", async () => {
    /** @type {string[]} */
    const order = [];
    const exclusive = async (/** @type {() => Promise<any>} */ fn) => { order.push("lock"); const r = await fn(); order.push("unlock"); return r; };
    await syncCache({ db: memoryCache(), fetchPage: async () => { order.push("fetch"); return { changes: [], next: 0, done: true }; },
      exclusive: /** @type {any} */ (exclusive) });
    expect(order).toEqual(["lock", "fetch", "unlock"]);
  });
});

describe("saveRecords", () => {
  it("seals, saves at the next version under the same item key, and keeps the sealed rows in the cache", async () => {
    const server = fakeServer();
    const { vault, cache } = await device(server);
    expect(await vault.saveRecords({ writes: [{ kind: "tie", id: "t1", base_version: 0, body: TIE }] }))
      .toEqual({ saved: [{ kind: "tie", id: "t1", version: 1 }] });
    const first = cache.data.records.get("t1");
    expect(first.body).toMatch(/^e2\./);
    expect(first.body).not.toContain("Futomomo");
    await vault.saveRecords({ writes: [{ kind: "tie", id: "t1", base_version: 1, body: { ...TIE, title: "Ebi" } }] });
    expect(cache.data.records.get("t1")).toMatchObject({ version: 2, seq: 2, key: first.key });
    expect((await vault.readCache({ ids: ["t1"] }))[0].body?.title).toBe("Ebi");
  });

  it("gives back the stale ids, saving nothing, when another device saved first", async () => {
    const server = fakeServer();
    const a = await device(server);
    await a.vault.saveRecords({ writes: [{ kind: "tie", id: "t1", base_version: 0, body: TIE }] });
    const b = await device(server, a.account);
    await b.vault.syncCache();
    await a.vault.saveRecords({ writes: [{ kind: "tie", id: "t1", base_version: 1, body: { ...TIE, title: "A" } }] });
    expect(await b.vault.saveRecords({ writes: [{ kind: "tie", id: "t1", base_version: 1, body: { ...TIE, title: "B" } }] }))
      .toEqual({ stale: ["t1"] });
    expect(b.cache.data.records.get("t1").version).toBe(1);
  });

  it("deletes, marking the id deleted in the cache", async () => {
    const server = fakeServer();
    const { vault, cache } = await device(server);
    await vault.saveRecords({ writes: [{ kind: "tie", id: "t1", base_version: 0, body: TIE }] });
    expect(await vault.saveRecords({ deletes: [{ kind: "tie", id: "t1", base_version: 1 }] }))
      .toEqual({ saved: [{ kind: "tie", id: "t1", version: null }] });
    expect([cache.data.records.has("t1"), cache.data.seen.get("t1").deleted]).toEqual([false, true]);
  });

  it("refuses a record that breaks its kind's rules before anything is sent", async () => {
    const server = fakeServer();
    const { vault } = await device(server);
    await expect(vault.saveRecords({ writes: [{ kind: "tie", id: "t1", base_version: 0, body: { title: "No date" } }] })).rejects.toThrow();
    expect(server.records.size).toBe(0);
  });

  it("needs the cache open, and forgets it on lock", async () => {
    const { vault } = await device(fakeServer());
    vault.lock();
    await expect(vault.readCache()).rejects.toThrow(/locked/);
  });
});
