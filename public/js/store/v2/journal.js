// The journal in memory (format 2): every record, opened, held by the page
// while it's unlocked, where the store's queries run over them. Read from
// the cache at unlock and kept up to date by syncing (on unlock, on coming
// back to the tab, after a save another device beat) and by the account's
// other tabs (cache/tabs.js). Dropped on lock: only the sealed cache stays
// on the device.
//
// Saving goes through the crypto Worker, which seals, saves to the server
// and puts the sealed rows in the cache. An edit another device saved
// over first is carried onto the newer version, field by field
// (cache/sync-rules.js's mergeEdit), and saved once more.

import * as vault from "../../vault.js";
import { api, ApiError } from "../../api.js";
import { openTabs } from "../../cache/tabs.js";
import { mergeEdit } from "../../cache/sync-rules.js";
import { orphanFiles } from "../../cache/orphans.js";

/** @typedef {import("../../crypto/records.js").RecordKind} RecordKind */
/** A record, opened. @typedef {{ kind: string, id: string, version: number, body: Record<string, any> | null, unreadable?: true }} Entry */
/**
 * A write: the record's new body; from, the body the edit started from
 * (default: the record as it is in memory now), for carrying it onto a
 * newer version if another device saved first.
 * @typedef {{ kind: RecordKind, id: string, body: Record<string, any>, from?: Record<string, any> }} Write
 * @typedef {{ kind: RecordKind, id: string, files?: string[] }} Delete
 * @typedef {{ changed: string[], removed: string[] }} Change
 */

/**
 * @typedef {{
 *   userId: string,
 *   format: 1 | 2,
 *   records: Map<string, Entry>,
 *   ready: Promise<void>,
 *   tabs: import("../../cache/tabs.js").Tabs | null,
 *   stop: AbortController,
 * }} State
 */

/** @type {State | null} */
let state = null;
/** @type {Promise<State> | null} */
let starting = null;
/** @type {Set<(change: Change) => void>} */
const listeners = new Set();

// Locking here locks the account's other tabs too (and theirs, this one).
vault.onWipe(() => {
  state?.tabs?.tellLock();
  state?.tabs?.close();
  state?.stop.abort();
  state = null;
  starting = null;
});

/**
 * At unlock: reads the account's format, and for format 2 opens the
 * journal (the first time on this device, waiting for it to sync down).
 * Once per unlock; later calls wait for the same.
 * @returns {Promise<1 | 2>}
 */
export async function startJournal() {
  starting ??= (async () => {
    const keys = await api("/api/keys");
    /** @type {State} */
    const next = {
      userId: keys.user_id, format: keys.format === 2 ? 2 : 1, records: new Map(), ready: Promise.resolve(), tabs: null,
      stop: new AbortController(),
    };
    state = next;
    if (next.format === 2) next.ready = open(next);
    return next;
  })();
  try {
    const started = await starting;
    await started.ready;
    return started.format;
  } catch (err) {
    starting = null;
    throw err;
  }
}

/** The account's format, once startJournal has run (1 before). */
export function accountFormat() {
  return state?.format ?? 1;
}

/** @param {State} s */
async function open(s) {
  await vault.openCache();
  for (const entry of await vault.readCache()) s.records.set(entry.id, entry);
  s.tabs = openTabs(s.userId, {
    onChanged: (changed, removed) => { reread(s, changed, removed).catch(() => {}); },
    onLock: () => vault.lock(),
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state === s) sync().catch(() => {});
  }, { signal: s.stop.signal });
  // The first time on this device, wait for the journal to come down;
  // otherwise show what's here and sync meanwhile.
  const first = s.records.size === 0;
  const synced = syncInto(s).then(() => ensureBasics(s));
  // Once up to date: files no record lists, deleted (in the background).
  synced.then(() => deleteOrphans(s)).catch(() => {});
  if (first) await synced;
  else synced.catch(() => {});
}

/**
 * Every readable record of a kind.
 * @param {RecordKind} kind
 * @returns {Entry[]}
 */
export function records(kind) {
  if (!state) return [];
  return [...state.records.values()].filter((r) => r.kind === kind && r.body);
}

/**
 * Every readable record, by id, for the queries to look links up in.
 * @returns {Map<string, Entry>}
 */
export function byId() {
  return new Map(state ? [...state.records].filter(([, r]) => r.body) : []);
}

/**
 * One record, if it's here and readable.
 * @param {string} id
 * @returns {Entry | null}
 */
export function record(id) {
  const entry = state?.records.get(id);
  return entry?.body ? entry : null;
}

/** How many records won't open (sealed under something else, or damaged). */
export function unreadableCount() {
  return state ? [...state.records.values()].filter((r) => r.unreadable).length : 0;
}

/**
 * @param {(change: Change) => void} listener called after records change (a
 *   save here, a sync, another tab)
 * @returns {() => void} stops it
 */
export function onJournalChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** @param {Change} change */
function emit(change) {
  if (!change.changed.length && !change.removed.length) return;
  for (const listener of listeners) listener(change);
}

/** Brings the journal up to date with the server. */
export async function sync() {
  if (!state || state.format !== 2) return;
  await syncInto(state);
}

/** @param {State} s */
async function syncInto(s) {
  const { records: changed, removed } = await vault.syncCache();
  if (state !== s) return;
  for (const entry of changed) s.records.set(entry.id, entry);
  for (const id of removed) s.records.delete(id);
  const change = { changed: changed.map((r) => r.id), removed };
  s.tabs?.tellChanged(change.changed, change.removed);
  emit(change);
}

/**
 * Another tab changed these: read them again from the cache.
 * @param {State} s
 * @param {string[]} changed
 * @param {string[]} removed
 */
async function reread(s, changed, removed) {
  const read = changed.length ? await vault.readCache(changed) : [];
  if (state !== s) return;
  for (const entry of read) s.records.set(entry.id, entry);
  for (const id of removed) s.records.delete(id);
  emit({ changed: read.map((r) => r.id), removed });
}

/** The most the server takes in one batch (src/records/parse.js's MAX_BATCH). */
export const MAX_BATCH = 50;

/**
 * Saves records and deletes others: all or none, up to MAX_BATCH at once.
 * More (deleting someone who's on many ties) go in several batches, the
 * writes first and the deletes last, so a batch that fails leaves nothing
 * pointing at a record that's gone. If another device saved one of them
 * first, syncs, carries each edit onto the newer version and saves once
 * more; a new record whose id another device took first (the same "this
 * is me" made on two at once) is left as theirs.
 * @param {{ writes?: Write[], deletes?: Delete[] }} batch
 */
export async function save({ writes = [], deletes = [] }) {
  /** @type {{ write?: Write, del?: Delete }[]} */
  const ops = [...writes.map((w) => ({ write: w })), ...deletes.map((d) => ({ del: d }))];
  for (let i = 0; i < ops.length; i += MAX_BATCH) {
    const part = ops.slice(i, i + MAX_BATCH);
    await saveBatch(
      part.flatMap((o) => (o.write ? [o.write] : [])),
      part.flatMap((o) => (o.del ? [o.del] : [])),
    );
  }
}

/**
 * @param {Write[]} writes
 * @param {Delete[]} deletes
 */
async function saveBatch(writes, deletes) {
  const s = live();
  const result = await attempt(s, writes, deletes);
  if (!("stale" in result)) return;
  await syncInto(s);
  const again = result.stale.length ? carryOver(s, writes, result.stale) : writes;
  const left = deletes.filter((d) => s.records.has(d.id));
  if (!again.length && !left.length) return;
  const second = await attempt(s, again, left);
  if ("stale" in second) throw new Error("Another device is changing this at the same time. Try again in a moment.");
}

/**
 * The writes, with those that were stale carried onto the newer versions
 * (and new ones another device made first dropped).
 * @param {State} s
 * @param {Write[]} writes
 * @param {string[]} stale
 * @returns {Write[]}
 */
function carryOver(s, writes, stale) {
  const staleIds = new Set(stale);
  return writes.flatMap((w) => {
    if (!staleIds.has(w.id)) return [w];
    const now = s.records.get(w.id);
    if (!now?.body) return [];
    if (!w.from) return [];
    return [{ ...w, body: mergeEdit(w.from, w.body, now.body) }];
  });
}

/**
 * @param {State} s
 * @param {Write[]} writes
 * @param {Delete[]} deletes
 */
async function attempt(s, writes, deletes) {
  const result = await vault.saveRecords({
    writes: writes.map((w) => ({ kind: w.kind, id: w.id, base_version: s.records.get(w.id)?.version ?? 0, body: w.body })),
    deletes: deletes.map((d) => ({
      kind: d.kind, id: d.id, base_version: /** @type {Entry} */ (s.records.get(d.id)).version, files: d.files ?? [],
    })),
  });
  if ("stale" in result) return result;
  const bodies = new Map(writes.map((w) => [w.id, w.body]));
  for (const saved of result.saved) {
    if (saved.version === null) s.records.delete(saved.id);
    else s.records.set(saved.id, { kind: saved.kind, id: saved.id, version: saved.version, body: bodies.get(saved.id) ?? null });
  }
  const change = { changed: writes.map((w) => w.id), removed: deletes.map((d) => d.id) };
  s.tabs?.tellChanged(change.changed, change.removed);
  emit(change);
  return result;
}

/** @returns {State} */
function live() {
  if (!state || state.format !== 2) throw new Error("Your journal is locked.");
  return state;
}

/**
 * What every format 2 journal has: its "this is me" person and its
 * settings record, at ids any device works out the same (records/ids.js),
 * and an identity key. Made here if missing, so an account whose sign-up
 * stopped half-way, or another device's, catches up.
 * @param {State} s
 */
async function ensureBasics(s) {
  const ids = await vault.recordIds({ self: true, settings: true });
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  /** @type {Write[]} */
  const writes = [];
  if (![...s.records.values()].some((r) => r.kind === "person" && r.body?.is_self)) {
    writes.push({ kind: "person", id: /** @type {string} */ (ids.self), body: { name: "Me", is_self: true, created_at: now, updated_at: now } });
  }
  if (!s.records.has(/** @type {string} */ (ids.settings))) {
    writes.push({ kind: "settings", id: /** @type {string} */ (ids.settings), body: { created_at: now, updated_at: now } });
  }
  if (writes.length && state === s) await save({ writes });
  // Not needed until contacts (phase 6): if it can't be made now, the next
  // unlock tries again.
  await ensureIdentity().catch(() => {});
}

/** Makes the account's identity key if it has none yet (PUT /api/identity, set once). */
async function ensureIdentity() {
  try {
    await api("/api/identity");
    return;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }
  const { publicKey, sealedSeed } = await vault.makeIdentity();
  await api("/api/identity", { method: "PUT", body: { public_key: publicKey, sealed_seed: sealedSeed } });
}

/**
 * Deletes my files that no record lists (cache/orphans.js): left by an
 * upload whose record never saved, or a delete that stopped half-way. Not
 * while any record won't open, as its files can't be told from orphans.
 * @param {State} s
 */
async function deleteOrphans(s) {
  if (state !== s || [...s.records.values()].some((r) => r.unreadable)) return;
  const files = await api("/api/files");
  const bodies = [...s.records.values()].map((r) => r.body ?? {});
  const orphans = orphanFiles(files, bodies, Date.now());
  for (let i = 0; i < orphans.length; i += 1000) {
    if (state !== s) return;
    await api("/api/files/delete", { method: "POST", body: { ids: orphans.slice(i, i + 1000) } });
  }
}
