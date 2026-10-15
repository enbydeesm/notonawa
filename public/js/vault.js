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

/** A secret didn't unlock (the Worker said "wrong-secret"). */
export class WrongSecret extends Error {
  constructor() {
    super("That doesn't unlock your journal.");
    this.name = "WrongSecret";
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
    else call.reject(error === "wrong-secret" ? new WrongSecret() : new Error(error));
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
  if (!unlocked) return;
  unlocked = false;
  if (!quiet) for (const listener of lockListeners) listener();
}

/** @param {() => void} listener called after the journal locks */
export function onLock(listener) {
  lockListeners.add(listener);
}
