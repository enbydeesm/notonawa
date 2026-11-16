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

import { newDataKey, wrapDataKey, unwrapDataKey, unwrapKeyMaterial, recoveryKeyMaterial } from "./keys.js";
import { sealRecord, openRecord, CantOpen } from "./fields.js";
import { matchingTies } from "../search-match.js";
import { sealPhoto, sealVideo, openPart, openPieces, sealCaption, openCaption, sealObject, mediaBinding } from "./media.js";
import { newShareKey, sealSnapshot, openSnapshot, sealShareFile, openShareFile } from "./share.js";
import { toBase64url, fromBase64url } from "./keys.js";
import { RECORD_KINDS, newItemKey, openItemKey, sealBody, openBody } from "./records.js";
import { newFileKey, fileKey, sealFile, openPart as openFilePart } from "./files.js";
import { newIdentity, sealSeed, openSeed } from "./identity.js";
import { sealAcceptance, openAcceptance, sealMessage, openMessage } from "./pair.js";
import { idKeyFrom, convertedId, selfId, settingsId } from "../records/ids.js";
import { checkRecord } from "../records/schema.js";
import { syncCache } from "../cache/sync.js";

/** @typedef {import("./keys.js").Wrap} Wrap */
/** @typedef {import("./fields.js").RecordKind} RecordKind */
/** @typedef {import("../search-match.js").IndexEntry} IndexEntry */
/**
 * A secret as sent by the page: a passkey's PRF output, or a recovery code
 * (canonical, see readRecoveryCode).
 * @typedef {{ prf: ArrayBuffer } | { code: string }} Secret
 */
/**
 * How the Worker reaches the cache and the server for records (format 2):
 * cache/db.js's openCache, GET /api/sync, POST /api/records (its status
 * and JSON), and a lock per account across tabs (cache/sync.js's webLock).
 * @typedef {{
 *   open: (userId: string) => Promise<import("../cache/sync-rules.js").CacheDb>,
 *   fetchSync: (since: number) => Promise<import("../cache/sync.js").SyncPage>,
 *   postRecords: (batch: unknown) => Promise<{ status: number, body: any }>,
 *   exclusive: (userId: string) => import("../cache/sync.js").Exclusive,
 * }} CacheIo
 */
/**
 * A record opened.
 * @typedef {{ kind: string, id: string, version: number, key: string, body: Record<string, unknown> | null,
 *   unreadable?: true }} Opened
 */

export class VaultCore {
  /** @type {CryptoKey | null} the data key, non-extractable */
  #key = null;
  /** @type {string | null} whose key it is (fields are bound to the user) */
  #userId = null;
  /** @type {IndexEntry[] | null} the ties' search index, notes opened */
  #index = null;
  /** @type {CryptoKey | null} the id key (records/ids.js), from the data key */
  #idKey = null;
  /** @type {Uint8Array | null} my identity key's seed, once opened */
  #identity = null;
  /** @type {import("../cache/sync-rules.js").CacheDb | null} the account's cache, once opened */
  #cache = null;

  /**
   * @param {() => Promise<IndexEntry[]>} [loadIndex] fetches the ties' search
   *   index (notes still sealed): the Worker fetches it itself, so notes of
   *   ties not on screen never reach the page
   * @param {(mediaId: string, part: "thumb" | "full") => Promise<ArrayBuffer>} [loadPart]
   *   fetches a sealed part of a photo: the Worker fetches photos itself
   *   too, so the page only ever asks for one by id
   * @param {(shareId: string, fileId: string, part: "thumb" | "full") => Promise<ArrayBuffer>} [loadShareFile]
   *   fetches a sealed part of a share's photo, likewise
   * @param {(fileId: string, part: "thumb" | "full") => Promise<ArrayBuffer>} [loadFile]
   *   fetches a sealed part of a format v3 file, likewise
   * @param {CacheIo} [cacheIo] the cache and the records routes (format 2)
   */
  constructor(loadIndex, loadPart, loadShareFile, loadFile, cacheIo) {
    this.#cacheIo = cacheIo ?? null;
    this.#loadIndex = loadIndex ?? (async () => []);
    this.#loadPart = loadPart ?? (async () => { throw new Error("No photos here."); });
    this.#loadShareFile = loadShareFile ?? (async () => { throw new Error("No shared photos here."); });
    this.#loadFile = loadFile ?? (async () => { throw new Error("No files here."); });
  }

  /** @type {(fileId: string, part: "thumb" | "full") => Promise<ArrayBuffer>} */
  #loadFile;
  /** @type {CacheIo | null} */
  #cacheIo;

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
    await this.#adopt(recovery, userId, recoverySecret);
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
      await this.#adopt(wrap, userId, bytes);
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
      if (!this.#key) await this.#adopt(proof.wrap, userId, proofBytes);
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
    this.#idKey = null;
    this.#identity?.fill(0);
    this.#identity = null;
    this.#cache?.close();
    this.#cache = null;
  }

  /**
   * Takes the data key from a wrap, non-extractable, and the id key made
   * from the same bytes (keys.js's unwrapKeyMaterial): the same on every
   * device, from any of the account's wraps.
   * @param {Wrap} wrap
   * @param {string} userId
   * @param {Uint8Array<ArrayBuffer>} secret
   */
  async #adopt(wrap, userId, secret) {
    const key = await unwrapDataKey(wrap, { userId, secret });
    const idKey = await idKeyFrom(await unwrapKeyMaterial(wrap, { userId, secret }), userId);
    this.#key = key;
    this.#idKey = idKey;
    this.#userId = userId;
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
   * Converting to format 2: one of my format 1 photos or videos, fetched and
   * opened as format 1 seals them, and sealed as a v3 file under a new key
   * of its own (for its item's record). What's opened never leaves the
   * Worker. Throws CantOpen if it won't open.
   * @param {{ mediaId: string, kind: "photo" | "video", newFileId: string }} args
   * @returns {Promise<{ key: string, body: ArrayBuffer, thumbBytes: number }>}
   */
  async convertMedia({ mediaId, kind, newFileId }) {
    const thumb = await this.openPhoto({ mediaId, part: "thumb", kind });
    const full = await this.openPhoto({ mediaId, part: "full", kind });
    return this.sealFile({ fileId: newFileId, thumb, full });
  }

  /**
   * Format 2: one of my v3 files, fetched and opened with the key from its
   * record, and sealed again for a share with its link's key, as the object
   * to upload. What's opened never leaves the Worker.
   * @param {{ shareId: string, key: string, fileId: string, sourceId: string, sourceKey: string, kind: "photo" | "video" }} args
   *   fileId: the share's file's id; sourceId and sourceKey: mine
   * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
   */
  async reshareFile({ shareId, key, fileId, sourceId, sourceKey, kind }) {
    const thumb = await this.openFile({ fileId: sourceId, key: sourceKey, part: "thumb" });
    const full = await this.openFile({ fileId: sourceId, key: sourceKey, part: "full" });
    const linkKey = fromBase64url(key);
    try {
      return await sealShareFile({ shareId, fileId, key: linkKey, video: kind === "video", thumb, full });
    } finally {
      linkKey.fill(0);
    }
  }

  /**
   * Format 2: a share's photo or video, fetched and opened with its link's
   * key, and sealed as one of my v3 files under a new key of its own (for
   * its item's record). Throws CantOpen if it won't open.
   * @param {{ shareId: string, key: string, fileId: string, kind: "photo" | "video", newFileId: string }} args
   * @returns {Promise<{ key: string, body: ArrayBuffer, thumbBytes: number }>}
   */
  async adoptShareAsFile({ shareId, key, fileId, kind, newFileId }) {
    this.#unlocked();
    const thumb = await this.#openShared({ shareId, key, fileId, kind, part: "thumb" });
    const full = await this.#openShared({ shareId, key, fileId, kind, part: "full" });
    return this.sealFile({ fileId: newFileId, thumb, full });
  }

  /**
   * One of my photos or videos, fetched, opened and sealed again bound to a
   * new id, as the object to upload: Copy to… another tie, plan or workshop
   * (photos-ui.js). Each is bound to its own id, so a copy is a new file;
   * what's opened never leaves the Worker. Throws CantOpen if it won't open.
   * @param {{ mediaId: string, newId: string, kind: "photo" | "video" }} args
   * @returns {Promise<{ body: ArrayBuffer, thumbBytes: number }>}
   */
  async copyMedia({ mediaId, newId, kind }) {
    const [dataKey, userId] = this.#unlocked();
    const thumb = await this.openPhoto({ mediaId, part: "thumb", kind });
    const full = await this.openPhoto({ mediaId, part: "full", kind });
    return sealObject(dataKey, mediaBinding(userId, newId), { thumb, full, video: kind === "video" });
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

  // Format 2: records, files, identity keys and contacts' messages. Each
  // works on whole records or files of a known kind; there's no general
  // decrypt, and keys leave only sealed (item keys) or inside a record
  // (file and pair keys, which the record already holds).

  /**
   * Record ids worked out rather than random (records/ids.js): a converted
   * row's, "this is me"'s and the settings record's.
   * @param {{ converted?: { table: string, oldId: string | number }[], self?: boolean, settings?: boolean }} args
   * @returns {Promise<{ converted: string[], self: string | null, settings: string | null }>}
   */
  async recordIds({ converted = [], self = false, settings = false }) {
    const [, userId] = this.#unlocked();
    const idKey = /** @type {CryptoKey} */ (this.#idKey);
    return {
      converted: await Promise.all(converted.map(({ table, oldId }) => convertedId(idKey, userId, table, oldId))),
      self: self ? await selfId(idKey, userId) : null,
      settings: settings ? await settingsId(idKey, userId) : null,
    };
  }

  /**
   * Records checked (records/schema.js) and sealed, each under its item key:
   * a new one's made when a record has none yet. version: the one being
   * written (1 more than the one it was based on).
   * @param {{ records: { kind: import("./records.js").RecordKind, id: string, version: number, key?: string | null,
   *   body: Record<string, unknown> }[] }} args
   * @returns {Promise<{ kind: string, id: string, version: number, key: string, body: string }[]>}
   */
  async sealRecords({ records }) {
    const [dataKey, userId] = this.#unlocked();
    return Promise.all(records.map(async ({ kind, id, version, key, body }) => {
      checkRecord(kind, body, { id });
      const where = { userId, kind, id };
      const item = key ? { key: await openItemKey(dataKey, where, key), sealed: key } : await newItemKey(dataKey, where);
      return { kind, id, version, key: item.sealed, body: await sealBody(item.key, { ...where, version }, body) };
    }));
  }

  /**
   * Records opened. One that won't open (or isn't a record of a known
   * kind) comes back with body null and unreadable: true, rather than
   * failing the rest. Item keys stay sealed.
   * @param {{ rows: { kind: string, id: string, version: number, key: string, body: string }[] }} args
   * @returns {Promise<{ kind: string, id: string, version: number, key: string, body: Record<string, unknown> | null,
   *   unreadable?: true }[]>}
   */
  async openRecords({ rows }) {
    const [dataKey, userId] = this.#unlocked();
    return Promise.all(rows.map(async (row) => {
      const { kind, id, version, key } = row;
      try {
        if (!(/** @type {readonly string[]} */ (RECORD_KINDS)).includes(kind)) throw new CantOpen();
        const where = { userId, kind: /** @type {import("./records.js").RecordKind} */ (kind), id };
        const body = await openBody(await openItemKey(dataKey, where, key), { ...where, version }, row.body);
        return { kind, id, version, key, body };
      } catch {
        return { kind, id, version, key, body: null, unreadable: /** @type {const} */ (true) };
      }
    }));
  }

  /**
   * A prepared photo or video sealed (format v3) under a new key of its own,
   * for its item's record.
   * @param {{ fileId: string, thumb: ArrayBuffer, full: ArrayBuffer }} args
   * @returns {Promise<{ key: string, body: ArrayBuffer, thumbBytes: number }>}
   */
  async sealFile({ fileId, thumb, full }) {
    const [, userId] = this.#unlocked();
    const key = newFileKey();
    return { key, ...(await sealFile(await fileKey(key), { userId, fileId }, { thumb, full })) };
  }

  /**
   * One part of a format v3 file, fetched and opened with the key from its
   * record. Throws CantOpen if it won't open.
   * @param {{ fileId: string, key: string, part: "thumb" | "full" }} args
   * @returns {Promise<ArrayBuffer>}
   */
  async openFile({ fileId, key, part }) {
    const [, userId] = this.#unlocked();
    const sealed = await this.#loadFile(fileId, part);
    return openFilePart(await fileKey(key), { userId, fileId, part }, sealed);
  }

  /**
   * A copy of a file under a new id and key (Copy to…, Duplicate).
   * @param {{ fileId: string, key: string, newFileId: string }} args
   * @returns {Promise<{ key: string, body: ArrayBuffer, thumbBytes: number }>}
   */
  async copyFile({ fileId, key, newFileId }) {
    const [thumb, full] = await Promise.all([
      this.openFile({ fileId, key, part: "thumb" }), this.openFile({ fileId, key, part: "full" }),
    ]);
    return this.sealFile({ fileId: newFileId, thumb, full });
  }

  /**
   * A new identity key pair, kept open here; its seed leaves only sealed.
   * @returns {Promise<{ publicKey: string, sealedSeed: string }>}
   */
  async makeIdentity() {
    const [dataKey, userId] = this.#unlocked();
    const { seed, publicKey } = await newIdentity();
    const sealedSeed = await sealSeed(dataKey, { userId, publicKey, seed });
    this.#identity?.fill(0);
    this.#identity = seed;
    return { publicKey: toBase64url(publicKey), sealedSeed };
  }

  /**
   * Opens my identity key's seed and keeps it here. Throws CantOpen if it
   * isn't mine, for that public key.
   * @param {{ publicKey: string, sealedSeed: string }} args
   */
  async openIdentity({ publicKey, sealedSeed }) {
    const [dataKey, userId] = this.#unlocked();
    const seed = await openSeed(dataKey, { userId, publicKey: fromBase64url(publicKey) }, sealedSeed);
    this.#identity?.fill(0);
    this.#identity = seed;
    return null;
  }

  /**
   * Accepting an invite: the acceptance sealed to the inviter (crypto/pair.js).
   * @param {{ inviterPublicKey: string, shareId: string, linkKey: string, payload: unknown }} args
   * @returns {Promise<ArrayBuffer>}
   */
  async sealAcceptance({ inviterPublicKey, shareId, linkKey, payload }) {
    this.#unlocked();
    const key = fromBase64url(linkKey);
    try {
      return (await sealAcceptance({ inviterPublicKey: fromBase64url(inviterPublicKey), shareId, linkKey: key, payload })).buffer;
    } finally {
      key.fill(0);
    }
  }

  /**
   * An acceptance of my invite, opened with my identity key. Throws CantOpen
   * unless it's for that share, from someone with its link.
   * @param {{ shareId: string, linkKey: string, sealed: ArrayBuffer }} args
   * @returns {Promise<unknown>}
   */
  async openAcceptance({ shareId, linkKey, sealed }) {
    this.#unlocked();
    if (!this.#identity) throw new Error("Open your identity key first.");
    const key = fromBase64url(linkKey);
    try {
      return await openAcceptance({ seed: this.#identity, shareId, linkKey: key, sealed: new Uint8Array(sealed) });
    } finally {
      key.fill(0);
    }
  }

  /**
   * A message to a contact's mailbox, sealed with our pair key.
   * @param {{ pairKey: string, mailboxId: string, counter: number, payload: unknown }} args
   * @returns {Promise<string>}
   */
  async sealMessage({ pairKey, mailboxId, counter, payload }) {
    this.#unlocked();
    return sealMessage(pairKey, { mailboxId, counter }, payload);
  }

  /**
   * A message from my mailbox, opened with our pair key. Throws CantOpen if
   * it isn't from my contact. Whether its counter is new is the caller's.
   * @param {{ pairKey: string, mailboxId: string, sealed: string }} args
   * @returns {Promise<{ counter: number, payload: unknown }>}
   */
  async openMessage({ pairKey, mailboxId, sealed }) {
    this.#unlocked();
    return openMessage(pairKey, mailboxId, sealed);
  }

  /**
   * Opens the account's cache (format 2), once per unlock.
   */
  async openCache() {
    const [, userId] = this.#unlocked();
    if (!this.#cacheIo) throw new Error("No cache here.");
    this.#cache ??= await this.#cacheIo.open(userId);
    return null;
  }

  /**
   * Brings the cache up to date with the server, and gives what changed,
   * opened (cache/sync.js).
   * @returns {Promise<{ records: Opened[], removed: string[], refused: string[] }>}
   */
  async syncCache() {
    const [cache, io, userId] = this.#cacheOpen();
    const { changed, removed, refused } = await syncCache({ db: cache, fetchPage: io.fetchSync, exclusive: io.exclusive(userId) });
    return { records: await this.openRecords({ rows: await cache.rows(changed) }), removed, refused };
  }

  /**
   * Records from the cache, opened: every one, or those asked for (an id
   * not there has been deleted, or never synced).
   * @param {{ ids?: string[] }} [args]
   * @returns {Promise<Opened[]>}
   */
  async readCache({ ids } = {}) {
    const [cache] = this.#cacheOpen();
    return this.openRecords({ rows: await cache.rows(ids) });
  }

  /**
   * Seals and saves records, and deletes others, in one batch (POST
   * /api/records, all or none), then puts them in the cache. A write's
   * version is one more than base_version (0 for a new record); its item
   * key is the cache's, or a new one. Stale (another device saved first):
   * nothing's saved, and the ids come back for the store to sync and
   * carry the edit over (cache/sync-rules.js's mergeEdit).
   * @param {{ writes?: { kind: import("./records.js").RecordKind, id: string, base_version: number,
   *     body: Record<string, unknown> }[],
   *   deletes?: { kind: import("./records.js").RecordKind, id: string, base_version: number, files?: string[] }[] }} args
   * @returns {Promise<{ saved: { kind: string, id: string, version: number | null }[] } | { stale: string[] }>}
   */
  async saveRecords({ writes = [], deletes = [] }) {
    const [cache, io, userId] = this.#cacheOpen();
    return io.exclusive(userId)(async () => {
      const keys = new Map((await cache.rows(writes.filter((w) => w.base_version > 0).map((w) => w.id))).map((r) => [r.id, r.key]));
      const sealed = await this.sealRecords({ records: writes.map((w) => ({
        kind: w.kind, id: w.id, version: w.base_version + 1, key: keys.get(w.id) ?? null, body: w.body,
      })) });
      const batch = {
        writes: sealed.map((row, i) => ({ id: row.id, kind: row.kind, base_version: writes[i].base_version, key: row.key, body: row.body })),
        deletes: deletes.map((d) => ({ id: d.id, kind: d.kind, base_version: d.base_version, files: d.files ?? [] })),
      };
      const res = await io.postRecords(batch);
      if (res.status === 409 && Array.isArray(res.body?.stale)) return { stale: /** @type {string[]} */ (res.body.stale) };
      if (res.status !== 200) throw new Error(res.body?.error ?? "Couldn't save. Check your connection and try again.");
      const seqs = new Map(/** @type {{ id: string, seq: number }[]} */ (res.body.saved).map((s) => [s.id, s.seq]));
      await cache.apply({
        puts: sealed.map((row) => ({ ...row, seq: /** @type {number} */ (seqs.get(row.id)) })),
        removes: deletes.map((d) => d.id),
        seen: [
          ...sealed.map((row) => ({ id: row.id, version: row.version, deleted: false })),
          ...deletes.map((d) => ({ id: d.id, version: d.base_version, deleted: true })),
        ],
      });
      return { saved: [
        ...sealed.map((row) => ({ kind: row.kind, id: row.id, version: row.version })),
        ...deletes.map((d) => ({ kind: d.kind, id: d.id, version: null })),
      ] };
    });
  }

  /** @returns {[import("../cache/sync-rules.js").CacheDb, CacheIo, string]} */
  #cacheOpen() {
    const [, userId] = this.#unlocked();
    if (!this.#cache || !this.#cacheIo) throw new Error("Open the cache first.");
    return [this.#cache, this.#cacheIo, userId];
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
