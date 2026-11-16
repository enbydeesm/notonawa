// Shares and format 2's files in the crypto Worker (vault-core.js): one of
// my v3 files sealed again for a share with its link's key (reshareFile),
// and a share's file sealed as another account's v3 file (adoptShareAsFile),
// end to end: what comes out is what went in, and nothing opens with the
// wrong key.
import { describe, it, expect } from "vitest";
import { VaultCore } from "../../public/js/crypto/vault-core.js";
import { newRecoveryCode, readRecoveryCode } from "../../public/js/recovery.js";
import { newShareId, newShareKey } from "../../public/js/crypto/share.js";
import { toBase64url } from "../../public/js/crypto/keys.js";

/**
 * Splits an uploaded object into the part asked for, as the server's
 * ranges do.
 * @param {{ body: ArrayBuffer, thumbBytes: number }} object
 * @param {"thumb" | "full"} part
 */
const partOf = (object, part) => (part === "thumb" ? object.body.slice(0, object.thumbBytes) : object.body.slice(object.thumbBytes));

/**
 * An unlocked vault whose files and share files are the objects given.
 * @param {string} userId
 * @param {Map<string, { body: ArrayBuffer, thumbBytes: number }>} files
 * @param {Map<string, { body: ArrayBuffer, thumbBytes: number }>} shared
 */
async function vaultFor(userId, files, shared) {
  const vault = new VaultCore(undefined, undefined,
    async (_shareId, fileId, part) => partOf(/** @type {any} */ (shared.get(fileId)), part),
    async (fileId, part) => partOf(/** @type {any} */ (files.get(fileId)), part));
  await vault.setup({ userId, code: /** @type {string} */ (readRecoveryCode(newRecoveryCode())) });
  return vault;
}

const bytes = (/** @type {number} */ n, /** @type {number} */ fill) => new Uint8Array(n).fill(fill).buffer;

describe("format 2 shares' files", () => {
  it("go from my v3 file to a share and into another account's v3 file, the same bytes all the way", async () => {
    /** @type {Map<string, any>} */
    const myFiles = new Map();
    /** @type {Map<string, any>} */
    const shareFiles = new Map();
    /** @type {Map<string, any>} */
    const theirFiles = new Map();
    const me = await vaultFor("me", myFiles, shareFiles);
    const them = await vaultFor("them", theirFiles, shareFiles);

    const mine = await me.sealFile({ fileId: "f1", thumb: bytes(10, 1), full: bytes(3000, 2) });
    myFiles.set("f1", mine);
    const shareId = newShareId();
    const linkKey = toBase64url(newShareKey());
    const forShare = await me.reshareFile({ shareId, key: linkKey, fileId: "s1", sourceId: "f1", sourceKey: mine.key, kind: "photo" });
    shareFiles.set("s1", forShare);

    const adopted = await them.adoptShareAsFile({ shareId, key: linkKey, fileId: "s1", kind: "photo", newFileId: "g1" });
    theirFiles.set("g1", adopted);
    expect(adopted.key).not.toBe(mine.key);
    expect(new Uint8Array(await them.openFile({ fileId: "g1", key: adopted.key, part: "thumb" }))).toEqual(new Uint8Array(bytes(10, 1)));
    expect(new Uint8Array(await them.openFile({ fileId: "g1", key: adopted.key, part: "full" }))).toEqual(new Uint8Array(bytes(3000, 2)));
  });

  it("won't open a share's file with another link's key, or mine with the wrong key", async () => {
    /** @type {Map<string, any>} */
    const files = new Map();
    /** @type {Map<string, any>} */
    const shared = new Map();
    const me = await vaultFor("me", files, shared);
    const mine = await me.sealFile({ fileId: "f1", thumb: bytes(4, 1), full: bytes(8, 2) });
    files.set("f1", mine);
    const shareId = newShareId();
    shared.set("s1", await me.reshareFile({ shareId, key: toBase64url(newShareKey()), fileId: "s1", sourceId: "f1", sourceKey: mine.key, kind: "photo" }));
    await expect(me.adoptShareAsFile({ shareId, key: toBase64url(newShareKey()), fileId: "s1", kind: "photo", newFileId: "g" })).rejects.toThrow();
    const other = await me.sealFile({ fileId: "f2", thumb: bytes(4, 1), full: bytes(8, 2) });
    await expect(me.reshareFile({ shareId, key: toBase64url(newShareKey()), fileId: "s2", sourceId: "f1", sourceKey: other.key, kind: "photo" }))
      .rejects.toThrow();
  });
});
