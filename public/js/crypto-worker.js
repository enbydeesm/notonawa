// The crypto Worker: a separate, walled-off part of the browser that holds
// the unlocked data key, so the page itself never has it. Started by
// vault.js; locking ends it (worker.terminate()), which drops the key and
// everything else it held.
//
// Messages are { id, op, args }; each gets { id, result } or { id, error },
// where error is "wrong-secret" when a secret didn't unlock, or a message.
// Its operations work on whole records of a known kind (seal or open a
// tie's notes, search the ties, seal a photo or open one of mine by id),
// never a general "decrypt this". Shares are sealed and opened with their
// own link's key, never the data key; their photos move between the two
// without leaving the Worker (only a shared thumbnail comes out, to show).

import { VaultCore } from "./crypto/vault-core.js";
import { WrongSecret } from "./crypto/keys.js";
import { TooLong, CantOpen } from "./crypto/fields.js";
import { openCache } from "./cache/db.js";
import { webLock } from "./cache/sync.js";

// The ties' search index, fetched here (with the session cookie, as the
// page's requests are) so the notes in it are only ever opened in here.
async function loadIndex() {
  const res = await fetch("/api/ties/search-index", { credentials: "same-origin" });
  if (!res.ok) throw new Error("Couldn't search. Reload the page and try again.");
  return res.json();
}

// A sealed part of a photo, fetched here too, so the page asks only by id.
/**
 * @param {string} mediaId
 * @param {"thumb" | "full"} part
 */
async function loadPart(mediaId, part) {
  const res = await fetch(`/api/media/${encodeURIComponent(mediaId)}/${part}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Couldn't load the photo. Reload the page and try again.");
  return res.arrayBuffer();
}

// A sealed part of a share's photo, fetched here as well (the ids in the
// body, as when opening a share).
/**
 * @param {string} shareId
 * @param {string} fileId
 * @param {"thumb" | "full"} part
 */
async function loadShareFile(shareId, fileId, part) {
  const res = await fetch("/api/shares/files", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: shareId, file: fileId, part }),
  });
  if (res.status === 404) throw new Error("This share's photos have gone: it has ended or been revoked.");
  if (!res.ok) throw new Error("Couldn't load the shared photo. Try again.");
  return res.arrayBuffer();
}

// A sealed part of a format v3 file (format 2), fetched here as photos are.
/**
 * @param {string} fileId
 * @param {"thumb" | "full"} part
 */
async function loadFile(fileId, part) {
  const res = await fetch(`/api/files/${encodeURIComponent(fileId)}/${part}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Couldn't load the photo. Reload the page and try again.");
  return res.arrayBuffer();
}

// Records (format 2): the cache, and the routes that sync and save them,
// called from here so the Worker keeps the cache and the server in step.
// A reply saying the page is out of date (410) asks for a reload.
/** @type {import("./crypto/vault-core.js").CacheIo} */
const cacheIo = {
  open: (userId) => openCache(userId),
  async fetchSync(since) {
    const res = await fetch(`/api/sync?since=${since}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(res.status === 410 ? "Reload the app to carry on." : "Couldn't sync your journal. Check your connection.");
    return res.json();
  },
  async postRecords(batch) {
    const res = await fetch("/api/records", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(batch),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  },
  exclusive: (userId) => webLock(`notonawa-sync-${userId}`),
};

const vault = new VaultCore(loadIndex, loadPart, loadShareFile, loadFile, cacheIo);

/** @type {Record<string, (args: any) => Promise<unknown>>} */
const OPERATIONS = {
  setup: (args) => vault.setup(args),
  unlock: async (args) => { await vault.unlock(args); return null; },
  addWrap: (args) => vault.addWrap(args),
  status: async () => ({ unlocked: vault.unlocked }),
  seal: (args) => vault.seal(args),
  open: (args) => vault.open(args),
  searchTies: (args) => vault.searchTies(args),
  forgetSearch: async () => { vault.forgetSearch(); return null; },
  sealPhoto: (args) => vault.sealPhoto(args),
  sealVideo: (args) => vault.sealVideo(args),
  openPhoto: (args) => vault.openPhoto(args),
  sealCaption: (args) => vault.sealCaption(args),
  openMedia: (args) => vault.openMedia(args),
  sealShare: (args) => vault.sealShare(args),
  openShare: (args) => vault.openShare(args),
  reshareMedia: (args) => vault.reshareMedia(args),
  openShareThumb: (args) => vault.openShareThumb(args),
  adoptShareFile: (args) => vault.adoptShareFile(args),
  copyMedia: (args) => vault.copyMedia(args),
  // Format 2.
  recordIds: (args) => vault.recordIds(args),
  openCache: () => vault.openCache(),
  syncCache: () => vault.syncCache(),
  readCache: (args) => vault.readCache(args),
  saveRecords: (args) => vault.saveRecords(args),
  sealFile: (args) => vault.sealFile(args),
  openFile: (args) => vault.openFile(args),
  copyFile: (args) => vault.copyFile(args),
  reshareFile: (args) => vault.reshareFile(args),
  convertMedia: (args) => vault.convertMedia(args),
  adoptShareAsFile: (args) => vault.adoptShareAsFile(args),
  makeIdentity: () => vault.makeIdentity(),
  openIdentity: (args) => vault.openIdentity(args),
  sealAcceptance: (args) => vault.sealAcceptance(args),
  openAcceptance: (args) => vault.openAcceptance(args),
  sealMessage: (args) => vault.sealMessage(args),
  openMessage: (args) => vault.openMessage(args),
};

// Results whose buffers are handed over to the page rather than copied
// (photos can be megabytes, videos tens of them).
/** @param {unknown} result @returns {Transferable[]} */
function buffersOut(result) {
  if (result instanceof ArrayBuffer) return [result];
  const body = /** @type {any} */ (result)?.body;
  return body instanceof ArrayBuffer ? [body] : [];
}

self.addEventListener("message", async (event) => {
  const { id, op, args } = event.data ?? {};
  const operation = OPERATIONS[op];
  try {
    if (!operation) throw new Error(`Unknown operation: ${op}`);
    const result = await operation(args);
    self.postMessage({ id, result }, { transfer: buffersOut(result) });
  } catch (err) {
    const error = err instanceof WrongSecret ? "wrong-secret"
      : err instanceof TooLong ? "too-long"
      : err instanceof CantOpen ? "cant-open"
      : String(err instanceof Error ? err.message : err);
    self.postMessage({ id, error });
  }
});
