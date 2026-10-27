import { describe, it, expect } from "vitest";
import {
  parseNewShare, parseShareId, shareProblem, sharePrefix, snapshotKey, shareOfKey, toBase64url, parseShareFile,
  shareFileProblem, parseFileRequest, fileKey, MAX_SNAPSHOT_BYTES, MAX_LIVE_SHARES, MAX_USES, MAX_SHARE_FILES,
} from "../../src/shares/parse.js";
import { MAX_ACCOUNT_BYTES, MAX_OBJECT_BYTES, MAX_VIDEO_BYTES } from "../../src/media/parse.js";
import { sealed } from "../sealed.js";

const ID = "AbCdEfGhIjKlMnOpQrStUv";
const snapshot = (/** @type {number} */ bytes) => toBase64url(new Uint8Array(bytes).fill(7));
const share = (/** @type {Record<string, unknown>} */ change = {}) => ({
  id: ID, kind: "tie", label: sealed("For Sam"), link_key: sealed("key"), expires: "1d", max_uses: 1, snapshot: snapshot(64), ...change,
});

describe("parseNewShare", () => {
  it("reads a share, with its expiry as a fixed SQLite modifier and its snapshot as bytes", () => {
    const parsed = parseNewShare(share());
    expect(parsed).toMatchObject({ id: ID, kind: "tie", label: sealed("For Sam"), linkKey: sealed("key"), expires: "+1 day", maxUses: 1 });
    expect(parsed.snapshot).toEqual(new Uint8Array(64).fill(7));
    expect(parseNewShare(share({ expires: "never", max_uses: null, label: null }))).toMatchObject({ expires: null, maxUses: null, label: null });
    expect(parseNewShare(share({ expires: "10m" })).expires).toBe("+10 minutes");
  });

  it("refuses ids, kinds and expiries it doesn't know", () => {
    expect(() => parseNewShare(share({ id: "short" }))).toThrow("isn't a share id");
    expect(() => parseNewShare(share({ id: `${ID.slice(1)}/` }))).toThrow("isn't a share id");
    expect(() => parseNewShare(share({ kind: "location" }))).toThrow("profile, tie, plan or workshop");
    expect(() => parseNewShare(share({ expires: "2d" }))).toThrow("how long");
    // Not something on Object's prototype either.
    expect(() => parseNewShare(share({ expires: "toString" }))).toThrow("how long");
    expect(() => parseNewShare(share({ expires: undefined }))).toThrow("how long");
  });

  it("allows 1 to 100 uses, or any number", () => {
    expect(parseNewShare(share({ max_uses: MAX_USES })).maxUses).toBe(MAX_USES);
    for (const bad of [0, MAX_USES + 1, 1.5, "2"]) expect(() => parseNewShare(share({ max_uses: bad }))).toThrow("between 1 and");
  });

  it("needs the link's key, sealed", () => {
    expect(() => parseNewShare(share({ link_key: null }))).toThrow("key wasn't encrypted");
    expect(() => parseNewShare(share({ link_key: "abc" }))).toThrow("key wasn't encrypted");
  });

  it("only takes a sealed name", () => {
    expect(() => parseNewShare(share({ label: "For Sam" }))).toThrow("wasn't encrypted");
    expect(() => parseNewShare(share({ label: `e1.AAAAAAAAAAAAAAAA.${"A".repeat(1000)}` }))).toThrow("too long");
  });

  it("refuses a snapshot too small to be sealed, too big, or not base64url", () => {
    expect(() => parseNewShare(share({ snapshot: snapshot(27) }))).toThrow("didn't arrive whole");
    expect(parseNewShare(share({ snapshot: snapshot(28) })).snapshot.length).toBe(28);
    expect(() => parseNewShare(share({ snapshot: snapshot(MAX_SNAPSHOT_BYTES + 1) }))).toThrow("too big");
    expect(() => parseNewShare(share({ snapshot: "abc+def/" }))).toThrow("didn't arrive whole");
    expect(() => parseNewShare(share({ snapshot: 12 }))).toThrow("didn't arrive whole");
    // A length base64 can't be.
    expect(() => parseNewShare(share({ snapshot: "A".repeat(41) }))).toThrow("didn't arrive whole");
  });
});

describe("parseShareId", () => {
  it("takes 22 base64url characters", () => {
    expect(parseShareId(ID)).toBe(ID);
    expect(() => parseShareId(`${ID}x`)).toThrow();
    expect(() => parseShareId(null)).toThrow();
  });
});

describe("shareProblem", () => {
  it("stops at 50 live shares, and at the account's 1 GB with photos", () => {
    expect(shareProblem({ live: MAX_LIVE_SHARES - 1, accountBytes: 0 }, 10)).toBeNull();
    expect(shareProblem({ live: MAX_LIVE_SHARES, accountBytes: 0 }, 10)).toMatch("at most 50");
    expect(shareProblem({ live: 0, accountBytes: MAX_ACCOUNT_BYTES - 10 }, 10)).toBeNull();
    expect(shareProblem({ live: 0, accountBytes: MAX_ACCOUNT_BYTES - 10 }, 11)).toMatch("filled your 1 GB");
  });
});

describe("R2 keys", () => {
  it("puts a share's files in its owner's folder, and reads them back", () => {
    expect(sharePrefix("u1", ID)).toBe(`u1/shares/${ID}/`);
    expect(snapshotKey("u1", ID)).toBe(`u1/shares/${ID}/snapshot`);
    expect(shareOfKey(snapshotKey("u1", ID))).toEqual({ ownerId: "u1", shareId: ID });
  });

  it("doesn't take a photo's key for a share's", () => {
    expect(shareOfKey("u1/0f8fad5b-d9cb-469f-a165-70867728950e")).toBeNull();
    expect(shareOfKey(`u1/shares/${ID}`)).toBeNull();
    expect(shareOfKey(`u1/shares/${ID}/a/b`)).toBeNull();
  });
});

describe("toBase64url", () => {
  it("encodes large snapshots without overflowing", () => {
    const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 31) % 256);
    const text = toBase64url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))).toEqual(bytes);
  });
});

const FILE = "0b6e1f2c-3d4a-4b5c-8d6e-7f8091a2b3c4";

describe("a share's photos and videos", () => {
  it("are counted on a new share, up to an item's worth, and never on a profile invite", () => {
    expect(parseNewShare(share()).files).toBe(0);
    expect(parseNewShare(share({ files: MAX_SHARE_FILES })).files).toBe(30);
    for (const files of [-1, 31, 1.5, "2"]) expect(() => parseNewShare(share({ files })), String(files)).toThrow("at most 30");
    expect(() => parseNewShare(share({ kind: "profile", files: 1 }))).toThrow("profile invite can't have photos");
  });

  it("are uploaded with their kind, size and where the thumbnail ends", () => {
    const params = new URLSearchParams({ kind: "video", thumb_bytes: "100" });
    expect(parseShareFile(FILE, params, "5000")).toEqual({ id: FILE, kind: "video", thumbBytes: 100, bytes: 5000 });
    expect(() => parseShareFile("../x", params, "5000")).toThrow("isn't a photo id");
    expect(() => parseShareFile(FILE, new URLSearchParams({ kind: "drawing", thumb_bytes: "1" }), "5")).toThrow("Only photos and videos");
    expect(() => parseShareFile(FILE, params, null)).toThrow("size wasn't sent");
    expect(() => parseShareFile(FILE, params, "100")).toThrow("thumbnail's size");
    expect(() => parseShareFile(FILE, params, String(MAX_VIDEO_BYTES + 1))).toThrow("too big to share");
    const photo = new URLSearchParams({ kind: "photo", thumb_bytes: "1" });
    expect(() => parseShareFile(FILE, photo, String(MAX_OBJECT_BYTES + 1))).toThrow("too big to share");
  });

  it("stop at as many as the share said, and 5 videos", () => {
    expect(shareFileProblem({ files: 2, stored: 1, videos: 0 }, "photo")).toBeNull();
    expect(shareFileProblem({ files: 2, stored: 2, videos: 0 }, "photo")).toContain("all its photos");
    expect(shareFileProblem({ files: 9, stored: 5, videos: 5 }, "video")).toContain("at most 5 videos");
    expect(shareFileProblem({ files: 9, stored: 5, videos: 5 }, "photo")).toBeNull();
  });

  it("are fetched by the share's id, the file's and the part", () => {
    expect(parseFileRequest({ id: ID, file: FILE, part: "thumb" })).toEqual({ id: ID, file: FILE, part: "thumb" });
    expect(() => parseFileRequest({ id: ID, file: FILE, part: "all" })).toThrow("thumb or full");
    expect(() => parseFileRequest({ id: ID, file: "x", part: "full" })).toThrow("isn't a photo id");
  });

  it("sit beside the snapshot, so the sweep and deleting the share take them too", () => {
    expect(fileKey("u1", ID, FILE)).toBe(`u1/shares/${ID}/${FILE}`);
    expect(shareOfKey(fileKey("u1", ID, FILE))).toEqual({ ownerId: "u1", shareId: ID });
    expect(fileKey("u1", ID, FILE).startsWith(sharePrefix("u1", ID))).toBe(true);
  });
});
