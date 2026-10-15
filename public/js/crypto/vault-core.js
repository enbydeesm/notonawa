// What the crypto Worker does, apart from receiving messages (that's
// crypto-worker.js), so it can be tested on its own. It holds the unlocked
// data key, non-extractable, and never hands it out: only wraps of it.
//
// Wrapping the key for a new secret always needs proof: an existing wrap and
// the secret that opens it (a passkey's PRF output, or the recovery code),
// given just now. Being unlocked isn't enough, or a script injected into the
// page could have the key wrapped for a secret it chose, and take it away.
//
// Secrets are wiped from memory (zeroed) once used, where JavaScript allows:
// PRF output arrives as bytes and can be; a recovery code is a string and
// can't.

import { newDataKey, wrapDataKey, unwrapDataKey, recoveryKeyMaterial } from "./keys.js";
import { sealRecord, openRecord } from "./fields.js";
import { matchingTies } from "../search-match.js";

/** @typedef {import("./keys.js").Wrap} Wrap */
/** @typedef {import("./fields.js").RecordKind} RecordKind */
/** @typedef {import("../search-match.js").IndexEntry} IndexEntry */
/**
 * A secret as sent by the page: a passkey's PRF output, or a recovery code
 * (canonical, see readRecoveryCode).
 * @typedef {{ prf: ArrayBuffer } | { code: string }} Secret
 */

export class VaultCore {
  /** @type {CryptoKey | null} the data key, non-extractable */
  #key = null;
  /** @type {string | null} whose key it is (fields are bound to the user) */
  #userId = null;
  /** @type {IndexEntry[] | null} the ties' search index, notes opened */
  #index = null;

  /**
   * @param {() => Promise<IndexEntry[]>} [loadIndex] fetches the ties' search
   *   index (notes still sealed): the Worker fetches it itself, so notes of
   *   ties not on screen never reach the page
   */
  constructor(loadIndex) {
    this.#loadIndex = loadIndex ?? (async () => []);
  }

  /** @type {() => Promise<IndexEntry[]>} */
  #loadIndex;

  get unlocked() {
    return this.#key !== null;
  }

  /**
   * Makes a new data key, wraps it for the recovery code (and the passkey,
   * if it gave PRF output), and stays unlocked with it.
   * @param {{ userId: string, code: string, prf?: ArrayBuffer | null }} args
   * @returns {Promise<{ recovery: Wrap, passkey: Wrap | null }>}
   */
  async setup({ userId, code, prf = null }) {
    const key = await newDataKey();
    const recoverySecret = recoveryKeyMaterial(code);
    const recovery = await this.#checkedWrap(key, userId, "recovery", recoverySecret);
    /** @type {Wrap | null} */
    let passkey = null;
    if (prf) {
      const secret = /** @type {Uint8Array<ArrayBuffer>} */ (new Uint8Array(prf));
      passkey = await this.#checkedWrap(key, userId, "passkey", secret);
      secret.fill(0);
    }
    this.#key = await unwrapDataKey(recovery, { userId, secret: recoverySecret });
    this.#userId = userId;
    recoverySecret.fill(0);
    return { recovery, passkey };
  }

  /**
   * Unlocks with a wrap and its secret. Throws WrongSecret if it doesn't open.
   * @param {{ userId: string, wrap: Wrap, secret: Secret }} args
   */
  async unlock({ userId, wrap, secret }) {
    const bytes = secretBytes(secret);
    try {
      this.#key = await unwrapDataKey(wrap, { userId, secret: bytes });
      this.#userId = userId;
    } finally {
      bytes.fill(0);
    }
  }

  /**
   * Wraps the key for a new secret, given proof (an existing wrap and its
   * secret). Unlocks too, if it wasn't already. Throws WrongSecret if the
   * proof doesn't open.
   * @param {{ userId: string, proof: { wrap: Wrap, secret: Secret }, add: { kind: "passkey" | "recovery", secret: Secret } }} args
   * @returns {Promise<Wrap>}
   */
  async addWrap({ userId, proof, add }) {
    const proofBytes = secretBytes(proof.secret);
    const newBytes = secretBytes(add.secret);
    try {
      const key = await unwrapDataKey(proof.wrap, { userId, secret: proofBytes }, { extractable: true });
      const wrap = await this.#checkedWrap(key, userId, add.kind, newBytes);
      this.#key ??= await unwrapDataKey(proof.wrap, { userId, secret: proofBytes });
      this.#userId = userId;
      return wrap;
    } finally {
      proofBytes.fill(0);
      newBytes.fill(0);
    }
  }

  /** Forgets the key, and everything opened with it. */
  lock() {
    this.#key = null;
    this.#userId = null;
    this.#index = null;
  }

  /**
   * Records with their kind's encrypted fields sealed, for saving.
   * @template {Record<string, any>} T
   * @param {{ kind: RecordKind, records: T[] }} args
   * @returns {Promise<T[]>}
   */
  async seal({ kind, records }) {
    const [key, userId] = this.#unlocked();
    return Promise.all(records.map((record) => sealRecord(key, userId, kind, record)));
  }

  /**
   * Records with their kind's encrypted fields opened, for showing.
   * @template {Record<string, any>} T
   * @param {{ kind: RecordKind, records: T[] }} args
   */
  async open({ kind, records }) {
    const [key, userId] = this.#unlocked();
    return Promise.all(records.map((record) => openRecord(key, userId, kind, record)));
  }

  /**
   * The ids of the ties a keyword matches (in title, notes or a linked
   * plan's title). The index is fetched and opened once, and kept until the
   * journal locks or a tie changes (forgetSearch).
   * @param {{ q: string }} args
   * @returns {Promise<string[]>}
   */
  async searchTies({ q }) {
    const [key, userId] = this.#unlocked();
    if (!this.#index) {
      const entries = await this.#loadIndex();
      this.#index = await Promise.all(entries.map((entry) => openRecord(key, userId, "tie", entry)));
    }
    return matchingTies(this.#index, q);
  }

  /** A tie was added, changed or deleted: the next search fetches the index again. */
  forgetSearch() {
    this.#index = null;
  }

  /** @returns {[CryptoKey, string]} */
  #unlocked() {
    if (!this.#key || !this.#userId) throw new Error("Your journal is locked.");
    return [this.#key, this.#userId];
  }

  /**
   * Wraps the key and unwraps the result once, so a wrap that wouldn't open
   * never reaches the server.
   * @param {CryptoKey} key extractable
   * @param {string} userId
   * @param {"passkey" | "recovery"} kind
   * @param {Uint8Array<ArrayBuffer>} secret
   */
  async #checkedWrap(key, userId, kind, secret) {
    const wrap = await wrapDataKey(key, { userId, kind, secret });
    await unwrapDataKey(wrap, { userId, secret });
    return wrap;
  }
}

/**
 * @param {Secret} secret
 * @returns {Uint8Array<ArrayBuffer>} a copy for the caller to zero (PRF output is the
 *   transferred buffer itself, zeroed through this view)
 */
function secretBytes(secret) {
  if ("prf" in secret) return /** @type {Uint8Array<ArrayBuffer>} */ (new Uint8Array(secret.prf));
  return recoveryKeyMaterial(secret.code);
}
