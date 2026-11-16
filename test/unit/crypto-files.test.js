// Sealed photos and videos, format v3 (public/js/crypto/files.js): a key of
// each file's own, every part in pieces bound to their place.
import { describe, it, expect } from "vitest";
import { sealPart, openPart, sealFile, fileKey, newFileKey, pieceData, PIECE_BYTES } from "../../public/js/crypto/files.js";
import { CantOpen } from "../../public/js/crypto/fields.js";

/**
 * @param {number} n
 * @param {number} start
 */
const seq = (n, start) => /** @type {Uint8Array<ArrayBuffer>} */ (Uint8Array.from({ length: n }, (_, i) => (start + i) & 255));
/** @param {Uint8Array} b */
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const USER = "user-1";
const FILE = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const FULL = { userId: USER, fileId: FILE, part: /** @type {const} */ ("full") };

describe("fixed vector", () => {
  // File key 10 11 … 2f; 10 bytes c0 … c9 in pieces of 4; piece n's IV is
  // 12 bytes counting up from 0x20 × (n + 1).
  const KEY = "EBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8";
  const SEALED = "202122232425262728292a2b0791878f3b59deb809aeb485846408b0e69cc341" +
    "404142434445464748494a4bc1392c42abff11177cb981bd58d4091243a299fa" +
    "606162636465666768696a6b6e845111df3b219042306e5bfe457ef0186f";

  it("seals to exactly this: three pieces, each IV, ciphertext and tag", async () => {
    const sealed = await sealPart(await fileKey(KEY), FULL, seq(10, 0xc0), { pieceBytes: 4, iv: (n) => seq(12, 0x20 * (n + 1)) });
    expect(hex(sealed)).toBe(SEALED);
    expect(sealed.length).toBe(10 + 3 * (12 + 16));
  });

  it("opens back to the bytes", async () => {
    const sealed = Uint8Array.from(SEALED.match(/../g) ?? [], (b) => parseInt(b, 16));
    expect(hex(new Uint8Array(await openPart(await fileKey(KEY), FULL, sealed, { pieceBytes: 4 })))).toBe(hex(seq(10, 0xc0)));
  });

  it("binds each piece to this string", () => {
    expect(pieceData(FULL, 2, true)).toBe(`notonawa|file|v3|user-1|${FILE}|full|2|last`);
    expect(pieceData({ ...FULL, part: "thumb" }, 0, false)).toBe(`notonawa|file|v3|user-1|${FILE}|thumb|0|more`);
  });
});

describe("parts", () => {
  const opts = { pieceBytes: 4 };

  it("open only as this file's part, under its key", async () => {
    const key = await fileKey(newFileKey());
    const sealed = await sealPart(key, FULL, seq(10, 0), opts);
    for (const other of [{ ...FULL, part: /** @type {const} */ ("thumb") }, { ...FULL, fileId: "other" }, { ...FULL, userId: "user-2" }]) {
      await expect(openPart(key, other, sealed, opts)).rejects.toThrow(CantOpen);
    }
    await expect(openPart(await fileKey(newFileKey()), FULL, sealed, opts)).rejects.toThrow(CantOpen);
  });

  it("refuse a part cut short at a piece's end, a piece added, or pieces swapped", async () => {
    const key = await fileKey(newFileKey());
    const sealed = await sealPart(key, FULL, seq(12, 0), opts); // three full pieces of 4
    const piece = 12 + 4 + 16;
    await expect(openPart(key, FULL, sealed.slice(0, 2 * piece), opts)).rejects.toThrow(CantOpen);
    const longer = new Uint8Array(sealed.length + piece);
    longer.set(sealed);
    longer.set(sealed.slice(piece, 2 * piece), sealed.length);
    await expect(openPart(key, FULL, longer, opts)).rejects.toThrow(CantOpen);
    const swapped = new Uint8Array(sealed);
    swapped.set(sealed.slice(piece, 2 * piece), 0);
    swapped.set(sealed.slice(0, piece), piece);
    await expect(openPart(key, FULL, swapped, opts)).rejects.toThrow(CantOpen);
    await expect(openPart(key, FULL, sealed.slice(0, 20), opts)).rejects.toThrow(CantOpen);
  });

  it("seal nothing as one piece, and open it", async () => {
    const key = await fileKey(newFileKey());
    const sealed = await sealPart(key, FULL, new Uint8Array(0));
    expect(sealed.length).toBe(28);
    expect((await openPart(key, FULL, sealed)).byteLength).toBe(0);
  });

  it("are a megabyte a piece", () => {
    expect(PIECE_BYTES).toBe(1024 * 1024);
  });

  it("aren't made for an unknown part", async () => {
    const key = await fileKey(newFileKey());
    await expect(sealPart(key, { ...FULL, part: /** @type {any} */ ("caption") }, seq(4, 0))).rejects.toThrow();
  });
});

describe("files", () => {
  it("go up as the thumbnail then the full size, each opening as its part", async () => {
    const key = await fileKey(newFileKey());
    const { body, thumbBytes } = await sealFile(key, { userId: USER, fileId: FILE }, { thumb: seq(5, 1).buffer, full: seq(9, 50).buffer });
    expect(thumbBytes).toBe(5 + 28);
    expect(hex(new Uint8Array(await openPart(key, { ...FULL, part: "thumb" }, body.slice(0, thumbBytes))))).toBe(hex(seq(5, 1)));
    expect(hex(new Uint8Array(await openPart(key, FULL, body.slice(thumbBytes))))).toBe(hex(seq(9, 50)));
    await expect(openPart(key, FULL, body.slice(0, thumbBytes))).rejects.toThrow(CantOpen);
  });
});

describe("file keys", () => {
  it("are 32 random bytes, new each time, used non-extractable", async () => {
    const a = newFileKey();
    expect(a).not.toBe(newFileKey());
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await fileKey(a)).extractable).toBe(false);
  });

  it("refuse anything else", async () => {
    for (const bad of ["", "abc", "!!!!", null, 42, newFileKey() + "AA"]) {
      await expect(fileKey(bad)).rejects.toThrow(CantOpen);
    }
  });
});
