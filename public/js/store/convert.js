// Converting this account from format 1 to format 2, on the device: the
// steps, each safe to run again. convert/plan.js works out the records;
// this reads, uploads, saves, checks and finishes. convert-dialog.js shows
// it.
//
// Nothing old is touched until the end: the format 1 journal stays as it
// is (the server refuses changes to it while converting) until every
// record and file is saved and read back, and only then does the finish
// make the account format 2 and delete the old rows, in one batch. A run
// that stops part-way (a tab closed, offline) leaves the account
// converting, and the next run picks up where it got to: records already
// saved are skipped (their ids are worked out, the same every time), and
// files are converted again unless a saved record already lists them.

import { api, ApiError } from "../api.js";
import * as vault from "../vault.js";
import { exportJournal } from "./v1/data.js";
import { listPosePresets } from "./v1/presets.js";
import { idRequests, idKey, planConversion, withFileKeys } from "../convert/plan.js";
import { stamp } from "../records/parse.js";

/**
 * @typedef {"reading" | "photos" | "entries" | "checking" | "finishing"} Stage
 * @typedef {{ stage: Stage, done: number, total: number }} Progress
 * @typedef {"files" | "half-records" | "finish"} StopAt where a test stops a run (as if the tab closed)
 */

/** A run a test stopped part-way. */
export class Stopped extends Error {
  constructor() {
    super("Stopped part-way.");
    this.name = "Stopped";
  }
}

const BATCH = 50;

/**
 * Converts the journal: start (or carry on), then every step to the finish.
 * @param {{ progress?: (p: Progress) => void, stopAt?: StopAt }} [options]
 * @returns {Promise<{ records: number, files: number, unreadable: number, unconverted: number }>}
 */
export async function convertJournal({ progress = () => {}, stopAt } = {}) {
  await api("/api/convert/start", { method: "POST", body: {} });

  // Read everything, opened, and plan the records.
  progress({ stage: "reading", done: 0, total: 1 });
  const { doc, unreadable } = await exportJournal();
  const presetIds = (await listPosePresets()).map((p) => p.id);
  const requests = idRequests(doc, presetIds);
  const worked = await vault.recordIds({ converted: requests, self: true, settings: true });
  const ids = {
    converted: new Map(requests.map((r, i) => [idKey(r.table, r.oldId), worked.converted[i]])),
    self: /** @type {string} */ (worked.self),
    settings: /** @type {string} */ (worked.settings),
  };
  const plan = planConversion(doc, presetIds, ids, stamp());

  await ensureIdentity();

  // What an earlier run got to.
  await vault.openCache();
  await vault.syncCache();
  const saved = new Map((await vault.readCache()).map((r) => [r.id, r]));
  /** @type {Map<string, { key: string, bytes?: number }>} file id -> its key, from a saved record */
  const savedKeys = new Map();
  for (const r of saved.values()) {
    for (const v of Array.isArray(r.body?.visuals) ? r.body.visuals : []) {
      if (v?.kind === "file" && v.key) savedKeys.set(v.id, { key: v.key, bytes: v.bytes });
    }
  }

  // Files first, each read back and opened before going on.
  const onServer = new Set(/** @type {{ id: string }[]} */ (await api("/api/files")).map((f) => f.id));
  /** @type {Map<string, { key: string, bytes?: number }>} */
  const keys = new Map();
  for (const [i, file] of plan.files.entries()) {
    progress({ stage: "photos", done: i, total: plan.files.length });
    const known = savedKeys.get(file.fileId);
    if (known && onServer.has(file.fileId)) {
      await vault.openFile({ fileId: file.fileId, key: known.key, part: "thumb" });
      keys.set(file.fileId, known);
      continue;
    }
    // Uploaded by a run that stopped before its record was saved: its key
    // went with that run, so it's made again.
    if (onServer.has(file.fileId)) await api("/api/files/delete", { method: "POST", body: { ids: [file.fileId] } });
    const sealed = await vault.convertMedia({ mediaId: file.mediaId, kind: file.kind, newFileId: file.fileId });
    const bytes = sealed.body.byteLength;
    const query = new URLSearchParams({ kind: file.kind, thumb_bytes: String(sealed.thumbBytes) });
    await api(`/api/files/${encodeURIComponent(file.fileId)}?${query}`, { method: "PUT", body: sealed.body });
    await vault.openFile({ fileId: file.fileId, key: sealed.key, part: "thumb" });
    keys.set(file.fileId, { key: sealed.key, bytes });
  }
  progress({ stage: "photos", done: plan.files.length, total: plan.files.length });
  if (stopAt === "files") throw new Stopped();

  // Records, the ones not saved yet, in batches.
  const records = withFileKeys(plan.records, keys).filter((r) => !saved.has(r.id));
  // A test's stop half-way: after the first half is saved.
  const upTo = stopAt === "half-records" ? Math.ceil(records.length / 2) : records.length;
  for (let i = 0; i < upTo; i += BATCH) {
    progress({ stage: "entries", done: i, total: records.length });
    const batch = records.slice(i, Math.min(i + BATCH, upTo));
    const result = await vault.saveRecords({ writes: batch.map((r) => ({ kind: r.kind, id: r.id, base_version: 0, body: r.body })) });
    // Saved meanwhile by another device converting too: the same records.
    if ("stale" in result) {
      const stale = new Set(result.stale);
      const rest = batch.filter((r) => !stale.has(r.id));
      if (rest.length) await vault.saveRecords({ writes: rest.map((r) => ({ kind: r.kind, id: r.id, base_version: 0, body: r.body })) });
    }
  }
  if (stopAt === "half-records") throw new Stopped();
  progress({ stage: "entries", done: records.length, total: records.length });

  // Read it all back: every planned record there, and readable.
  progress({ stage: "checking", done: 0, total: 1 });
  await vault.syncCache();
  const back = new Map((await vault.readCache()).map((r) => [r.id, r]));
  const missing = plan.records.filter((r) => !back.get(r.id)?.body);
  if (missing.length) {
    throw new Error(`${missing.length} entries didn't save. Nothing has changed: try again.`);
  }
  if (stopAt === "finish") throw new Stopped();

  progress({ stage: "finishing", done: 0, total: 1 });
  await api("/api/convert/finish", { method: "POST", body: {} });
  return { records: plan.records.length, files: plan.files.length, unreadable, unconverted: plan.unconverted };
}

/** The account's identity key: kept if an earlier run made it. */
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
