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
import { sealPhoto, openPart, sealCaption, openCaption } from "./media.js";

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
   * @param {(mediaId: string, part: "thumb" | "full") => Promise<ArrayBuffer>} [loadPart]
   *   fetches a sealed part of a photo: the Worker fetches photos itself
   *   too, so the page only ever asks for one by id
   */
  constructor(loadIndex, loadPart) {
    this.#loadIndex = loadIndex ?? (async () => []);
    this.#loadPart = loadPart ?? (async () => { throw new Error("No photos here."); });
  }

  /** @type {() => Promise<IndexEntry[]>} */
  #loadIndex;
  /** @type {(mediaId: string, part: "thumb" | "full") => Promise<ArrayBuffer>} */
  #loadPart;

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

  /**
   * A prepared photo (metadata already stripped) sealed into the object to
   * upload, bound to its id.
   * @param {{ mediaId: string, thumb: ArrayBuffer, full: ArrayBuffer }} args
   * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
   */
  async sealPhoto({ mediaId, thumb, full }) {
    const [key, userId] = this.#unlocked();
    return sealPhoto(key, { userId, mediaId }, { thumb, full });
  }

  /**
   * One of my photos' thumbnail or full size, fetched and opened. Throws
   * CantOpen if it won't open.
   * @param {{ mediaId: string, part: "thumb" | "full" }} args
   * @returns {Promise<ArrayBuffer>}
   */
  async openPhoto({ mediaId, part }) {
    const [key, userId] = this.#unlocked();
    return openPart(key, { userId, mediaId, part }, await this.#loadPart(mediaId, part));
  }

  /**
   * A caption sealed for its photo (null if empty).
   * @param {{ mediaId: string, caption: unknown }} args
   * @returns {Promise<string | null>}
   */
  async sealCaption({ mediaId, caption }) {
    const [key, userId] = this.#unlocked();
    return sealCaption(key, { userId, mediaId }, caption);
  }

  /**
   * Photos (as GET /api/media lists them) with their captions opened. A
   * caption that won't open is null, with unreadable: ["caption"].
   * @template {{ id: string, caption: string | null }} T
   * @param {{ records: T[] }} args
   * @returns {Promise<(T & { unreadable?: string[] })[]>}
   */
  async openMedia({ records }) {
    const [key, userId] = this.#unlocked();
    return Promise.all(records.map(async (record) => {
      try {
        return { ...record, caption: await openCaption(key, { userId, mediaId: record.id }, record.caption) };
      } catch {
        return { ...record, caption: null, unreadable: ["caption"] };
      }
    }));
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
