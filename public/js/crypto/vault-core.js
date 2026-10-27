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
import { sealPhoto, sealVideo, openPart, openPieces, sealCaption, openCaption, sealObject, mediaBinding } from "./media.js";
import { newShareKey, sealSnapshot, openSnapshot, sealShareFile, openShareFile } from "./share.js";
import { toBase64url, fromBase64url } from "./keys.js";

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
   * @param {(shareId: string, fileId: string, part: "thumb" | "full") => Promise<ArrayBuffer>} [loadShareFile]
   *   fetches a sealed part of a share's photo, likewise
   */
  constructor(loadIndex, loadPart, loadShareFile) {
    this.#loadIndex = loadIndex ?? (async () => []);
    this.#loadPart = loadPart ?? (async () => { throw new Error("No photos here."); });
    this.#loadShareFile = loadShareFile ?? (async () => { throw new Error("No shared photos here."); });
  }

  /** @type {() => Promise<IndexEntry[]>} */
  #loadIndex;
  /** @type {(mediaId: string, part: "thumb" | "full") => Promise<ArrayBuffer>} */
  #loadPart;
  /** @type {(shareId: string, fileId: string, part: "thumb" | "full") => Promise<ArrayBuffer>} */
  #loadShareFile;

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
   * A prepared video (re-encoded without its metadata) sealed into the
   * object to upload, bound to its id: its full size in pieces.
   * @param {{ mediaId: string, thumb: ArrayBuffer, full: ArrayBuffer }} args
   * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
   */
  async sealVideo({ mediaId, thumb, full }) {
    const [key, userId] = this.#unlocked();
    return sealVideo(key, { userId, mediaId }, { thumb, full });
  }

  /**
   * One of my photos' or videos' thumbnail or full size, fetched and
   * opened. Throws CantOpen if it won't open.
   * @param {{ mediaId: string, part: "thumb" | "full", kind?: "photo" | "video" }} args
   * @returns {Promise<ArrayBuffer>}
   */
  async openPhoto({ mediaId, part, kind = "photo" }) {
    const [key, userId] = this.#unlocked();
    const sealed = await this.#loadPart(mediaId, part);
    if (kind === "video" && part === "full") return openPieces(key, { userId, mediaId }, sealed);
    return openPart(key, { userId, mediaId, part }, sealed);
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

  /**
   * Seals a share's snapshot with a new key of its own (crypto/share.js),
   * for the link. Doesn't touch the data key, but like everything else
   * here only runs while the journal is unlocked.
   * @param {{ id: string, kind: import("./share.js").ShareKind, data: unknown }} args
   * @returns {Promise<{ key: string, body: ArrayBuffer }>} the link's key (base64url) and the sealed snapshot
   */
  async sealShare({ id, kind, data }) {
    this.#unlocked();
    const key = newShareKey();
    const sealed = await sealSnapshot({ id, kind, key, data });
    const result = { key: toBase64url(key), body: sealed.buffer };
    key.fill(0);
    return result;
  }

  /**
   * Opens a share's snapshot with the key from its link. Throws CantOpen
   * if it won't.
   * @param {{ id: string, kind: import("./share.js").ShareKind, key: string, sealed: ArrayBuffer }} args
   * @returns {Promise<unknown>}
   */
  async openShare({ id, kind, key, sealed }) {
    this.#unlocked();
    const linkKey = fromBase64url(key);
    try {
      return await openSnapshot({ id, kind, key: linkKey, sealed: new Uint8Array(sealed) });
    } finally {
      linkKey.fill(0);
    }
  }

  /**
   * One of my photos or videos, fetched, opened and sealed again for a
   * share with its link's key, as the object to upload: what's opened
   * never leaves the Worker.
   * @param {{ shareId: string, key: string, fileId: string, mediaId: string, kind: "photo" | "video" }} args
   * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
   */
  async reshareMedia({ shareId, key, fileId, mediaId, kind }) {
    const thumb = await this.openPhoto({ mediaId, part: "thumb", kind });
    const full = await this.openPhoto({ mediaId, part: "full", kind });
    const linkKey = fromBase64url(key);
    try {
      return await sealShareFile({ shareId, fileId, key: linkKey, video: kind === "video", thumb, full });
    } finally {
      linkKey.fill(0);
    }
  }

  /**
   * A share's photo's or video's thumbnail, fetched and opened with its
   * link's key, for the preview. Throws CantOpen if it won't open.
   * @param {{ shareId: string, key: string, fileId: string, kind: "photo" | "video" }} args
   * @returns {Promise<ArrayBuffer>}
   */
  async openShareThumb({ shareId, key, fileId, kind }) {
    this.#unlocked();
    return this.#openShared({ shareId, key, fileId, kind, part: "thumb" });
  }

  /**
   * A share's photo or video, fetched, opened with its link's key and
   * sealed as one of mine (bound to a new id), as the object to upload:
   * what's opened never leaves the Worker. Throws CantOpen if it won't open.
   * @param {{ shareId: string, key: string, fileId: string, kind: "photo" | "video", mediaId: string }} args
   * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
   */
  async adoptShareFile({ shareId, key, fileId, kind, mediaId }) {
    const [dataKey, userId] = this.#unlocked();
    const thumb = await this.#openShared({ shareId, key, fileId, kind, part: "thumb" });
    const full = await this.#openShared({ shareId, key, fileId, kind, part: "full" });
    return sealObject(dataKey, mediaBinding(userId, mediaId), { thumb, full, video: kind === "video" });
  }

  /**
   * @param {{ shareId: string, key: string, fileId: string, kind: "photo" | "video", part: "thumb" | "full" }} args
   * @returns {Promise<ArrayBuffer>}
   */
  async #openShared({ shareId, key, fileId, kind, part }) {
    const sealed = await this.#loadShareFile(shareId, fileId, part);
    const linkKey = fromBase64url(key);
    try {
      return await openShareFile({ shareId, fileId, key: linkKey, video: kind === "video", part, sealed });
    } finally {
      linkKey.fill(0);
    }
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
