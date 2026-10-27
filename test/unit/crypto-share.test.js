// Sealing and opening shares (public/js/crypto/share.js).
import { describe, it, expect } from "vitest";
import {
  newShareId, newShareKey, sealSnapshot, openSnapshot, shareFragment, readShareFragment, sealShareFile, openShareFile,
  SHARE_KINDS,
} from "../../public/js/crypto/share.js";
import { PIECE_BYTES } from "../../public/js/crypto/media.js";
import { CantOpen } from "../../public/js/crypto/fields.js";
import { SHARE_KINDS as SERVER_KINDS } from "../../src/shares/parse.js";

const DATA = { title: "Floor session", notes: "Slow and steady", people: [{ name: "Sam", role: "bottom" }] };

describe("share ids and keys", () => {
  it("makes 22-character ids the server takes, and 32-byte keys", () => {
    const id = newShareId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newShareId()).not.toBe(id);
    expect(newShareKey()).toHaveLength(32);
  });

  it("knows the same kinds as the server", () => {
    expect(SHARE_KINDS).toEqual(SERVER_KINDS);
  });
});

describe("sealSnapshot and openSnapshot", () => {
  it("opens with the same key, id and kind", async () => {
    const id = newShareId();
    const key = newShareKey();
    const sealed = await sealSnapshot({ id, kind: "tie", key, data: DATA });
    expect(new TextDecoder().decode(sealed)).not.toContain("Floor session");
    expect(await openSnapshot({ id, kind: "tie", key, sealed })).toEqual(DATA);
  });

  it("won't open with another key, for another share or kind, or changed", async () => {
    const id = newShareId();
    const key = newShareKey();
    const sealed = await sealSnapshot({ id, kind: "plan", key, data: DATA });
    await expect(openSnapshot({ id, kind: "plan", key: newShareKey(), sealed })).rejects.toThrow(CantOpen);
    await expect(openSnapshot({ id: newShareId(), kind: "plan", key, sealed })).rejects.toThrow(CantOpen);
    await expect(openSnapshot({ id, kind: "tie", key, sealed })).rejects.toThrow(CantOpen);
    const changed = sealed.slice();
    changed[changed.length - 1] ^= 1;
    await expect(openSnapshot({ id, kind: "plan", key, sealed: changed })).rejects.toThrow(CantOpen);
    await expect(openSnapshot({ id, kind: "plan", key, sealed: sealed.slice(0, 20) })).rejects.toThrow(CantOpen);
  });

  it("seals each time with a new IV", async () => {
    const id = newShareId();
    const key = newShareKey();
    const a = await sealSnapshot({ id, kind: "tie", key, data: DATA });
    const b = await sealSnapshot({ id, kind: "tie", key, data: DATA });
    expect(a).not.toEqual(b);
  });

  it("refuses a kind that isn't one", async () => {
    await expect(sealSnapshot({ id: newShareId(), kind: /** @type {any} */ ("location"), key: newShareKey(), data: DATA }))
      .rejects.toThrow("Not a kind of share");
  });
});

describe("the link's fragment", () => {
  it("carries the id and key, and reads back with or without the #", () => {
    const id = newShareId();
    const key = newShareKey();
    const fragment = shareFragment(id, key);
    expect(fragment).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(readShareFragment(fragment)).toEqual({ id, key });
    expect(readShareFragment(`#${fragment}`)).toEqual({ id, key });
  });

  it("reads nothing from a fragment that isn't exactly one", () => {
    const fragment = shareFragment(newShareId(), newShareKey());
    for (const bad of ["", "#", `${fragment}x`, `x${fragment}`, fragment.replace(".", ""), `${fragment}#more`, "#/ties"]) {
      expect(readShareFragment(bad), bad).toBeNull();
    }
  });
});

describe("a share's photos and videos", () => {
  const FILE = "0b6e1f2c-3d4a-4b5c-8d6e-7f8091a2b3c4";
  const OTHER_FILE = "1b6e1f2c-3d4a-4b5c-8d6e-7f8091a2b3c4";
  const bytes = (/** @type {number} */ n, /** @type {number} */ fill) => new Uint8Array(n).fill(fill).buffer;

  /** @param {boolean} video */
  async function sealedFile(video) {
    const shareId = newShareId();
    const key = newShareKey();
    const full = bytes(video ? PIECE_BYTES + 10 : 50, 2);
    const { body, thumbBytes } = await sealShareFile({ shareId, fileId: FILE, key, video, thumb: bytes(5, 1), full });
    return { shareId, key, thumb: body.slice(0, thumbBytes), full: body.slice(thumbBytes), video, fullBytes: full.byteLength };
  }

  it("open with the link's key, as the thumbnail then the full size (a video's in pieces)", async () => {
    for (const video of [false, true]) {
      const f = await sealedFile(video);
      const thumb = await openShareFile({ shareId: f.shareId, fileId: FILE, key: f.key, video, part: "thumb", sealed: f.thumb });
      const full = await openShareFile({ shareId: f.shareId, fileId: FILE, key: f.key, video, part: "full", sealed: f.full });
      expect([...new Uint8Array(thumb)]).toEqual([1, 1, 1, 1, 1]);
      expect(full.byteLength).toBe(f.fullBytes);
      expect(new Uint8Array(full).every((b) => b === 2)).toBe(true);
    }
  });

  it("won't open with another key, share or file id, as the other part, or as the snapshot", async () => {
    const f = await sealedFile(false);
    const base = { shareId: f.shareId, fileId: FILE, key: f.key, video: false, part: /** @type {const} */ ("full"), sealed: f.full };
    await expect(openShareFile({ ...base, key: newShareKey() })).rejects.toThrow(CantOpen);
    await expect(openShareFile({ ...base, shareId: newShareId() })).rejects.toThrow(CantOpen);
    await expect(openShareFile({ ...base, fileId: OTHER_FILE })).rejects.toThrow(CantOpen);
    await expect(openShareFile({ ...base, part: "thumb" })).rejects.toThrow(CantOpen);
    await expect(openShareFile({ ...base, sealed: f.thumb })).rejects.toThrow(CantOpen);
    // The snapshot's key is another one made from the same link key.
    await expect(openSnapshot({ id: f.shareId, kind: "tie", key: f.key, sealed: new Uint8Array(f.full) })).rejects.toThrow(CantOpen);
  });

  it("won't open a video cut short", async () => {
    const f = await sealedFile(true);
    const cut = f.full.slice(0, 12 + PIECE_BYTES + 16);
    await expect(openShareFile({ shareId: f.shareId, fileId: FILE, key: f.key, video: true, part: "full", sealed: cut }))
      .rejects.toThrow(CantOpen);
  });
});
