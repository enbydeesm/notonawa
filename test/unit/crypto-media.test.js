// Sealed photos and captions (public/js/crypto/media.js), and the crypto
// Worker's photo operations (vault-core.js).
import { describe, it, expect } from "vitest";
import {
  sealPart, openPart, sealPhoto, sealCaption, openCaption, CaptionTooLong, MAX_CAPTION,
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
  });
});
