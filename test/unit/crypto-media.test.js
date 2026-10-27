// Sealed photos, videos and captions (public/js/crypto/media.js), and the
// crypto Worker's photo and video operations (vault-core.js).
import { describe, it, expect } from "vitest";
import {
  sealPart, openPart, sealPhoto, sealVideo, sealPieces, openPieces, sealCaption, openCaption, CaptionTooLong,
  MAX_CAPTION, PIECE_BYTES,
} from "../../public/js/crypto/media.js";
import { CantOpen, isSealed } from "../../public/js/crypto/fields.js";
import { newDataKey } from "../../public/js/crypto/keys.js";
import { VaultCore } from "../../public/js/crypto/vault-core.js";
import { newRecoveryCode, readRecoveryCode } from "../../public/js/recovery.js";
import { parseCaption } from "../../src/media/parse.js";

const USER = "user-1";
const PHOTO = "0b6e1f2c-3d4a-4b5c-8d6e-7f8091a2b3c4";
const OTHER_PHOTO = "1b6e1f2c-3d4a-4b5c-8d6e-7f8091a2b3c4";

/** @param {number[]} values */
const bytes = (values) => new Uint8Array(values).buffer;

describe("sealed photo parts", () => {
  it("open to the same bytes, and hide them", async () => {
    const key = await newDataKey();
    const where = { userId: USER, mediaId: PHOTO, part: /** @type {const} */ ("full") };
    const sealed = await sealPart(key, where, bytes([1, 2, 3, 4]));
    expect(sealed.length).toBe(12 + 4 + 16);
    expect([...new Uint8Array(await openPart(key, where, sealed.buffer))]).toEqual([1, 2, 3, 4]);
  });

  it("don't open as another photo, part or user, or with another key", async () => {
    const key = await newDataKey();
    const where = { userId: USER, mediaId: PHOTO, part: /** @type {const} */ ("thumb") };
    const sealed = (await sealPart(key, where, bytes([9]))).buffer;
    for (const other of [{ ...where, mediaId: OTHER_PHOTO }, { ...where, part: /** @type {const} */ ("full") }, { ...where, userId: "user-2" }]) {
      await expect(openPart(key, other, sealed)).rejects.toThrow(CantOpen);
    }
    await expect(openPart(await newDataKey(), where, sealed)).rejects.toThrow(CantOpen);
  });

  it("make one object: the thumbnail, then the full size", async () => {
    const key = await newDataKey();
    const { body, thumbBytes } = await sealPhoto(key, { userId: USER, mediaId: PHOTO }, { thumb: bytes([1, 1]), full: bytes([2, 2, 2]) });
    expect(thumbBytes).toBe(12 + 2 + 16);
    expect(body.byteLength).toBe(thumbBytes + 12 + 3 + 16);
    const thumb = await openPart(key, { userId: USER, mediaId: PHOTO, part: "thumb" }, body.slice(0, thumbBytes));
    const full = await openPart(key, { userId: USER, mediaId: PHOTO, part: "full" }, body.slice(thumbBytes));
    expect([...new Uint8Array(thumb)]).toEqual([1, 1]);
    expect([...new Uint8Array(full)]).toEqual([2, 2, 2]);
  });
});

describe("a video's full size, sealed in pieces", () => {
  const where = { userId: USER, mediaId: PHOTO };
  // Small pieces, so a few bytes make several: 3 of 4 bytes, the last of 2.
  const PIECE = 4;
  const SEALED_PIECE = 12 + PIECE + 16;
  const video = () => bytes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

  it("opens to the same bytes, piece by piece", async () => {
    const key = await newDataKey();
    const sealed = await sealPieces(key, where, video(), PIECE);
    expect(sealed.length).toBe(3 * SEALED_PIECE + 12 + 2 + 16);
    expect([...new Uint8Array(await openPieces(key, where, sealed.buffer, PIECE))]).toEqual([...new Uint8Array(video())]);
  });

  it("works with a size that fills its last piece, and with 1 MB pieces", async () => {
    const key = await newDataKey();
    const even = bytes([1, 2, 3, 4, 5, 6, 7, 8]);
    const sealed = await sealPieces(key, where, even, PIECE);
    expect(sealed.length).toBe(2 * SEALED_PIECE);
    expect([...new Uint8Array(await openPieces(key, where, sealed.buffer, PIECE))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const big = new Uint8Array(PIECE_BYTES * 2 + 5).map((_, i) => (i * 7) % 251);
    const opened = new Uint8Array(await openPieces(key, where, (await sealPieces(key, where, big.buffer)).buffer));
    expect(opened.length).toBe(big.length);
    expect(opened.every((b, i) => b === big[i])).toBe(true);
  });

  it("won't open cut short, even at a piece's end, or with pieces swapped", async () => {
    const key = await newDataKey();
    const sealed = (await sealPieces(key, where, video(), PIECE)).buffer;
    for (const cut of [sealed.slice(0, 2 * SEALED_PIECE), sealed.slice(0, sealed.byteLength - 1), sealed.slice(0, 20), new ArrayBuffer(0)]) {
      await expect(openPieces(key, where, cut, PIECE)).rejects.toThrow(CantOpen);
    }
    const swapped = new Uint8Array(sealed.byteLength);
    swapped.set(new Uint8Array(sealed.slice(SEALED_PIECE, 2 * SEALED_PIECE)), 0);
    swapped.set(new Uint8Array(sealed.slice(0, SEALED_PIECE)), SEALED_PIECE);
    swapped.set(new Uint8Array(sealed.slice(2 * SEALED_PIECE)), 2 * SEALED_PIECE);
    await expect(openPieces(key, where, swapped.buffer, PIECE)).rejects.toThrow(CantOpen);
  });

  it("won't open as another video's or user's, with another key, or as a photo", async () => {
    const key = await newDataKey();
    const sealed = (await sealPieces(key, where, video(), PIECE)).buffer;
    await expect(openPieces(key, { ...where, mediaId: OTHER_PHOTO }, sealed, PIECE)).rejects.toThrow(CantOpen);
    await expect(openPieces(key, { ...where, userId: "user-2" }, sealed, PIECE)).rejects.toThrow(CantOpen);
    await expect(openPieces(await newDataKey(), where, sealed, PIECE)).rejects.toThrow(CantOpen);
    const one = (await sealPieces(key, where, bytes([1, 2]), PIECE)).buffer;
    await expect(openPart(key, { ...where, part: "full" }, one)).rejects.toThrow(CantOpen);
  });

  it("makes one object with the thumbnail first, sealed as a photo's is", async () => {
    const key = await newDataKey();
    const { body, thumbBytes } = await sealVideo(key, where, { thumb: bytes([9, 9]), full: video() });
    expect([...new Uint8Array(await openPart(key, { ...where, part: "thumb" }, body.slice(0, thumbBytes)))]).toEqual([9, 9]);
    expect(new Uint8Array(await openPieces(key, where, body.slice(thumbBytes))).length).toBe(14);
  });
});

describe("sealed captions", () => {
  it("open to the trimmed text, for their own photo only", async () => {
    const key = await newDataKey();
    const sealed = await sealCaption(key, { userId: USER, mediaId: PHOTO }, "  Front, ö  ");
    expect(isSealed(sealed)).toBe(true);
    expect(await openCaption(key, { userId: USER, mediaId: PHOTO }, sealed)).toBe("Front, ö");
    await expect(openCaption(key, { userId: USER, mediaId: OTHER_PHOTO }, sealed)).rejects.toThrow(CantOpen);
    // Not plain text either: captions were never stored unsealed.
    await expect(openCaption(key, { userId: USER, mediaId: PHOTO }, "Front")).rejects.toThrow(CantOpen);
  });

  it("are null when empty, refused when too long, and pass the server's check", async () => {
    const key = await newDataKey();
    const where = { userId: USER, mediaId: PHOTO };
    expect(await sealCaption(key, where, "  ")).toBeNull();
    await expect(sealCaption(key, where, "x".repeat(MAX_CAPTION + 1))).rejects.toThrow(CaptionTooLong);
    // The longest caption, in characters that take 4 bytes each, still fits.
    const longest = await sealCaption(key, where, "🙂".repeat(MAX_CAPTION / 2));
    expect(parseCaption(longest)).toBe(longest);
  });
});

describe("the crypto Worker's photo operations", () => {
  async function unlocked() {
    /** @type {Map<string, ArrayBuffer>} */
    const server = new Map();
    const vault = new VaultCore(undefined, async (id, part) => {
      const body = /** @type {ArrayBuffer} */ (server.get(id));
      const thumbBytes = /** @type {number} */ (server.get(`${id}:thumb`)?.byteLength);
      return part === "thumb" ? body.slice(0, thumbBytes) : body.slice(thumbBytes);
    });
    await vault.setup({ userId: USER, code: /** @type {string} */ (readRecoveryCode(newRecoveryCode())) });
    /** @param {string} id @param {{ body: ArrayBuffer, thumbBytes: number }} sealed */
    const store = (id, { body, thumbBytes }) => {
      server.set(id, body);
      server.set(`${id}:thumb`, new ArrayBuffer(thumbBytes));
    };
    return { vault, store };
  }

  it("seal a photo, then fetch and open either part by id", async () => {
    const { vault, store } = await unlocked();
    store(PHOTO, await vault.sealPhoto({ mediaId: PHOTO, thumb: bytes([1]), full: bytes([2, 3]) }));
    expect([...new Uint8Array(await vault.openPhoto({ mediaId: PHOTO, part: "thumb" }))]).toEqual([1]);
    expect([...new Uint8Array(await vault.openPhoto({ mediaId: PHOTO, part: "full" }))]).toEqual([2, 3]);
  });

  it("seal a video, then open its full size from its pieces", async () => {
    const { vault, store } = await unlocked();
    store(PHOTO, await vault.sealVideo({ mediaId: PHOTO, thumb: bytes([1]), full: bytes([2, 3, 4]) }));
    expect([...new Uint8Array(await vault.openPhoto({ mediaId: PHOTO, part: "thumb", kind: "video" }))]).toEqual([1]);
    expect([...new Uint8Array(await vault.openPhoto({ mediaId: PHOTO, part: "full", kind: "video" }))]).toEqual([2, 3, 4]);
    await expect(vault.openPhoto({ mediaId: PHOTO, part: "full" })).rejects.toThrow(CantOpen);
  });

  it("won't open one photo's file as another's", async () => {
    const { vault, store } = await unlocked();
    store(OTHER_PHOTO, await vault.sealPhoto({ mediaId: PHOTO, thumb: bytes([1]), full: bytes([2]) }));
    await expect(vault.openPhoto({ mediaId: OTHER_PHOTO, part: "full" })).rejects.toThrow(CantOpen);
  });

  it("open captions, marking ones that won't", async () => {
    const { vault } = await unlocked();
    const caption = await vault.sealCaption({ mediaId: PHOTO, caption: "Side" });
    const opened = await vault.openMedia({ records: [
      { id: PHOTO, caption }, { id: OTHER_PHOTO, caption }, { id: OTHER_PHOTO, caption: null },
    ] });
    expect(opened).toEqual([
      { id: PHOTO, caption: "Side" },
      { id: OTHER_PHOTO, caption: null, unreadable: ["caption"] },
      { id: OTHER_PHOTO, caption: null },
    ]);
  });

  it("do nothing while locked", async () => {
    const vault = new VaultCore();
    await expect(vault.sealPhoto({ mediaId: PHOTO, thumb: bytes([1]), full: bytes([2]) })).rejects.toThrow("locked");
    await expect(vault.openPhoto({ mediaId: PHOTO, part: "thumb" })).rejects.toThrow("locked");
    await expect(vault.sealVideo({ mediaId: PHOTO, thumb: bytes([1]), full: bytes([2]) })).rejects.toThrow("locked");
  });
});

describe("the sealed format", () => {
  // Pinned with the additional data spelled out, so a change to how it's
  // made (it's shared with shares' files) can't leave photos already
  // stored unopenable.
  const open = async (/** @type {CryptoKey} */ key, /** @type {string} */ aad, /** @type {Uint8Array} */ sealed) => new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.slice(0, 12), additionalData: new TextEncoder().encode(aad) }, key, sealed.slice(12)));

  it("binds a photo's parts and caption as it always has", async () => {
    const key = await newDataKey();
    const { body, thumbBytes } = await sealPhoto(key, { userId: USER, mediaId: PHOTO }, { thumb: bytes([1]), full: bytes([2, 3]) });
    const object = new Uint8Array(body);
    expect([...await open(key, `notonawa|media|v1|${USER}|${PHOTO}|thumb`, object.slice(0, thumbBytes))]).toEqual([1]);
    expect([...await open(key, `notonawa|media|v1|${USER}|${PHOTO}|full`, object.slice(thumbBytes))]).toEqual([2, 3]);
  });

  it("binds a video's pieces as it always has", async () => {
    const key = await newDataKey();
    const sealed = await sealPieces(key, { userId: USER, mediaId: PHOTO }, bytes([1, 2, 3]), 2);
    expect([...await open(key, `notonawa|media|v2|${USER}|${PHOTO}|full|0|more`, sealed.slice(0, 12 + 2 + 16))]).toEqual([1, 2]);
    expect([...await open(key, `notonawa|media|v2|${USER}|${PHOTO}|full|1|last`, sealed.slice(12 + 2 + 16))]).toEqual([3]);
  });
});
