// The page's side of the crypto Worker (crypto-worker.js), which holds the
// unlocked encryption key. The page never has the key: it asks the Worker
// to unlock, to wrap the key for a new secret (with proof), and later (step
// 5) for the results it displays. Locking ends the Worker, which drops the
// key and everything it decrypted.
//
// PRF output is transferred to the Worker, not copied, so the page's buffer
// is emptied as it goes.

const WORKER_URL = "/js/crypto-worker.js";

// The CSP's Trusted Types rules only let a script URL through a named
// policy (trusted-types crypto-worker in public/_headers); this one allows
// just the crypto Worker. Browsers without Trusted Types take the plain URL.
/** @type {any} */
const trustedTypes = /** @type {any} */ (globalThis).trustedTypes;
const policy = trustedTypes?.createPolicy("crypto-worker", {
  createScriptURL: (/** @type {string} */ url) => {
    if (url !== WORKER_URL) throw new TypeError(`Not the crypto Worker: ${url}`);
    return url;
  },
});

/** @typedef {import("./crypto/keys.js").Wrap} Wrap */
/** @typedef {import("./crypto/vault-core.js").Secret} Secret */

/** @type {Worker | null} */
let worker = null;
let unlocked = false;
let nextId = 0;
/** @type {Map<number, { resolve: (value: any) => void, reject: (err: Error) => void }>} */
const waiting = new Map();
/** @type {Set<() => void>} */
const lockListeners = new Set();
/** @type {Set<() => void>} */
const wipers = new Set();

/** A secret didn't unlock (the Worker said "wrong-secret"). */
export class WrongSecret extends Error {
  constructor() {
    super("That doesn't unlock your journal.");
    this.name = "WrongSecret";
  }
}

/** Something of mine that won't decrypt (the Worker said "cant-open"). */
export class CantOpen extends Error {
  constructor() {
    super("This can't be decrypted.");
    this.name = "CantOpen";
  }
}

function start() {
  if (worker) return worker;
  const url = policy ? policy.createScriptURL(WORKER_URL) : WORKER_URL;
  const started = new Worker(url, { type: "module" });
  started.addEventListener("message", (event) => {
    const { id, result, error } = event.data;
    const call = waiting.get(id);
    if (!call) return;
    waiting.delete(id);
    if (error === undefined) call.resolve(result);
    else call.reject(error === "wrong-secret" ? new WrongSecret()
      : error === "too-long" ? new Error("That's too long to save. Shorten the notes, please.")
      : error === "cant-open" ? new CantOpen() : new Error(error));
  });
  started.addEventListener("error", () => fail(new Error("The encryption part of the app stopped. Reload the page.")));
  worker = started;
  return started;
}

/** @param {Error} err */
function fail(err) {
  for (const call of waiting.values()) call.reject(err);
  waiting.clear();
}

/**
 * @param {string} op
 * @param {unknown} args
 * @param {Transferable[]} transfer buffers to hand over (PRF output)
 * @returns {Promise<any>}
 */
function call(op, args, transfer = []) {
  const target = start();
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    target.postMessage({ id, op, args }, transfer);
  });
}

/** @param {Secret} secret */
const buffersIn = (secret) => ("prf" in secret ? [secret.prf] : []);

/** Whether the journal is unlocked in this tab. */
export function isUnlocked() {
  return unlocked;
}

/**
 * Makes the account's first key (or a new one), wrapped for the recovery
 * code and, if given, the passkey's PRF output. Unlocked afterwards.
 * @param {{ userId: string, code: string, prf: ArrayBuffer | null }} args code canonical
 * @returns {Promise<{ recovery: Wrap, passkey: Wrap | null }>}
 */
export async function setup(args) {
  const wraps = await call("setup", args, args.prf ? [args.prf] : []);
  unlocked = true;
  return wraps;
}

/**
 * @param {{ userId: string, wrap: Wrap, secret: Secret }} args
 * @throws {WrongSecret}
 */
export async function unlock(args) {
  await call("unlock", args, buffersIn(args.secret));
  unlocked = true;
}

/**
 * Wraps the key for a new secret, given proof (an existing wrap and its
 * secret, given just now). Unlocks too, if it wasn't.
 * @param {{ userId: string, proof: { wrap: Wrap, secret: Secret }, add: { kind: "passkey" | "recovery", secret: Secret } }} args
 * @returns {Promise<Wrap>}
 * @throws {WrongSecret}
 */
export async function addWrap(args) {
  const wrap = await call("addWrap", args, [...buffersIn(args.proof.secret), ...buffersIn(args.add.secret)]);
  unlocked = true;
  return wrap;
}

/** @typedef {import("./crypto/fields.js").RecordKind} RecordKind */

/**
 * Records with their kind's notes sealed, for saving. Text is trimmed, and
 * empty text becomes null.
 * @template {Record<string, any>} T
 * @param {RecordKind} kind
 * @param {T[]} records
 * @returns {Promise<T[]>}
 */
export function seal(kind, records) {
  return call("seal", { kind, records });
}

/**
 * One record with its kind's notes sealed.
 * @template {Record<string, any>} T
 * @param {RecordKind} kind
 * @param {T} record
 * @returns {Promise<T>}
 */
export async function sealOne(kind, record) {
  return (await seal(kind, [record]))[0];
}

/**
 * Records with their kind's notes opened, for showing. A field that won't
 * open is null and listed in `unreadable`.
 * @template {Record<string, any>} T
 * @param {RecordKind} kind
 * @param {T[]} records
 * @returns {Promise<(T & { unreadable?: string[] })[]>}
 */
export function open(kind, records) {
  return call("open", { kind, records });
}

/**
 * The ids of the ties a keyword matches. Searched in the Worker, which
 * fetches and opens the ties' notes itself.
 * @param {string} q
 * @returns {Promise<string[]>}
 */
export function searchTies(q) {
  return call("searchTies", { q });
}

/** A tie was saved or deleted: the next search starts afresh. */
export function forgetSearch() {
  if (worker) call("forgetSearch", {}).catch(() => {});
}

/**
 * A prepared photo (metadata already stripped) sealed for upload, bound to
 * its id. The two buffers are handed to the Worker, so they're emptied here.
 * @param {string} mediaId made with crypto.randomUUID()
 * @param {ArrayBuffer} thumb
 * @param {ArrayBuffer} full
 * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
 */
export function sealPhoto(mediaId, thumb, full) {
  return call("sealPhoto", { mediaId, thumb, full }, [thumb, full]);
}

/**
 * A prepared video (re-encoded without its metadata) sealed for upload,
 * bound to its id. The two buffers are handed to the Worker, so they're
 * emptied here.
 * @param {string} mediaId made with crypto.randomUUID()
 * @param {ArrayBuffer} thumb
 * @param {ArrayBuffer} full
 * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
 */
export function sealVideo(mediaId, thumb, full) {
  return call("sealVideo", { mediaId, thumb, full }, [thumb, full]);
}

/**
 * One of my photos' or videos' thumbnail or full size, decrypted. The
 * Worker fetches it itself. Throws CantOpen if it won't decrypt.
 * @param {string} mediaId
 * @param {"thumb" | "full"} part
 * @param {"photo" | "video"} [kind] a video's full size is sealed in pieces
 * @returns {Promise<ArrayBuffer>}
 */
export function openPhoto(mediaId, part, kind = "photo") {
  return call("openPhoto", { mediaId, part, kind });
}

/**
 * A caption sealed for its photo (null if empty).
 * @param {string} mediaId
 * @param {string} caption
 * @returns {Promise<string | null>}
 */
export function sealCaption(mediaId, caption) {
  return call("sealCaption", { mediaId, caption });
}

/**
 * Photos as GET /api/media lists them, with captions opened (null, and
 * unreadable: ["caption"], if one won't).
 * @template {{ id: string, caption: string | null }} T
 * @param {T[]} records
 * @returns {Promise<(T & { unreadable?: string[] })[]>}
 */
export function openMedia(records) {
  return call("openMedia", { records });
}

/**
 * A share's snapshot sealed with a new key of its own (crypto/share.js),
 * bound to its id and kind. The key goes in the link, and only there.
 * @param {string} id from newShareId()
 * @param {import("./crypto/share.js").ShareKind} kind
 * @param {unknown} data the copy, as JSON
 * @returns {Promise<{ key: string, body: ArrayBuffer }>} the key (base64url) and the sealed snapshot
 */
export function sealShare(id, kind, data) {
  return call("sealShare", { id, kind, data });
}

/**
 * A share's snapshot opened with the key from its link. The sealed bytes
 * are handed to the Worker, so they're emptied here. Throws CantOpen if it
 * won't open.
 * @param {string} id
 * @param {import("./crypto/share.js").ShareKind} kind
 * @param {string} key base64url, from the link
 * @param {ArrayBuffer} sealed
 * @returns {Promise<unknown>}
 */
export function openShare(id, kind, key, sealed) {
  return call("openShare", { id, kind, key, sealed }, [sealed]);
}

/**
 * Locks: ends the Worker, dropping the key and all it held.
 * @param {{ quiet?: boolean }} [options] quiet: don't tell the lock
 *   listeners (the page is showing something else, e.g. "Account deleted")
 */
export function lock({ quiet = false } = {}) {
  if (worker) {
    worker.terminate();
    worker = null;
    fail(new Error("Locked."));
  }
  for (const wipe of wipers) wipe();
  if (!unlocked) return;
  unlocked = false;
  if (!quiet) for (const listener of lockListeners) listener();
}

/** @param {() => void} listener called after the journal locks */
export function onLock(listener) {
  lockListeners.add(listener);
}

/**
 * @param {() => void} wipe called on every lock, quiet ones too, to drop
 *   decrypted things the page holds outside the Worker (photos' blob: URLs)
 */
export function onWipe(wipe) {
  wipers.add(wipe);
}
