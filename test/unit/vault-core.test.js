// What the crypto Worker does (public/js/crypto/vault-core.js).
import { describe, it, expect } from "vitest";
import { VaultCore } from "../../public/js/crypto/vault-core.js";
import { WrongSecret } from "../../public/js/crypto/keys.js";
import { newRecoveryCode, readRecoveryCode } from "../../public/js/recovery.js";
import { newShareId } from "../../public/js/crypto/share.js";
import { CantOpen } from "../../public/js/crypto/fields.js";

const USER = "user-1";
const newPrf = () => crypto.getRandomValues(new Uint8Array(32));
// A copy, as the vault zeroes what it's given.
const give = (/** @type {Uint8Array} */ bytes) => bytes.slice().buffer;
const newCode = () => /** @type {string} */ (readRecoveryCode(newRecoveryCode()));

async function setUp() {
  const vault = new VaultCore();
  const prf = newPrf();
  const code = newCode();
  const wraps = await vault.setup({ userId: USER, code, prf: give(prf) });
  return { vault, prf, code, wraps };
}

describe("VaultCore", () => {
  it("sets up a key wrapped for the passkey and the recovery code, and stays unlocked", async () => {
    const { vault, prf, code, wraps } = await setUp();
    expect(vault.unlocked).toBe(true);
    expect(wraps.passkey?.kind).toBe("passkey");
    expect(wraps.recovery.kind).toBe("recovery");

    const again = new VaultCore();
    await again.unlock({ userId: USER, wrap: /** @type {any} */ (wraps.passkey), secret: { prf: give(prf) } });
    expect(again.unlocked).toBe(true);
    again.lock();
    expect(again.unlocked).toBe(false);
    await again.unlock({ userId: USER, wrap: wraps.recovery, secret: { code } });
    expect(again.unlocked).toBe(true);
  });

  it("sets up with only the recovery code when the passkey gave no PRF output", async () => {
    const wraps = await new VaultCore().setup({ userId: USER, code: newCode() });
    expect(wraps.passkey).toBeNull();
  });

  it("stays locked when a secret doesn't unlock", async () => {
    const { wraps } = await setUp();
    const vault = new VaultCore();
    await expect(vault.unlock({ userId: USER, wrap: wraps.recovery, secret: { code: newCode() } })).rejects.toThrow(WrongSecret);
    expect(vault.unlocked).toBe(false);
  });

  it("wraps the key for a new secret only with proof, and the new wrap unlocks", async () => {
    const { vault, prf, code, wraps } = await setUp();
    const laptop = newPrf();
    const wrap = await vault.addWrap({
      userId: USER, proof: { wrap: wraps.recovery, secret: { code } }, add: { kind: "passkey", secret: { prf: give(laptop) } },
    });
    const fresh = new VaultCore();
    await fresh.unlock({ userId: USER, wrap, secret: { prf: give(laptop) } });
    expect(fresh.unlocked).toBe(true);

    // Unlocked, but the wrong proof: no new wrap.
    await expect(vault.addWrap({
      userId: USER, proof: { wrap: /** @type {any} */ (wraps.passkey), secret: { prf: give(newPrf()) } }, add: { kind: "recovery", secret: { code: newCode() } },
    })).rejects.toThrow(WrongSecret);
    // A new recovery code, proved with the passkey.
    const newCodeText = newCode();
    const recovery = await vault.addWrap({
      userId: USER, proof: { wrap: /** @type {any} */ (wraps.passkey), secret: { prf: give(prf) } }, add: { kind: "recovery", secret: { code: newCodeText } },
    });
    await new VaultCore().unlock({ userId: USER, wrap: recovery, secret: { code: newCodeText } });
  });

  it("unlocks when adding a wrap while locked (recovering with the code)", async () => {
    const { code, wraps } = await setUp();
    const vault = new VaultCore();
    await vault.addWrap({ userId: USER, proof: { wrap: wraps.recovery, secret: { code } }, add: { kind: "passkey", secret: { prf: give(newPrf()) } } });
    expect(vault.unlocked).toBe(true);
  });

  it("zeroes PRF output once it's used", async () => {
    const prf = newPrf();
    const buffer = give(prf);
    await new VaultCore().setup({ userId: USER, code: newCode(), prf: buffer });
    expect(new Uint8Array(buffer).every((b) => b === 0)).toBe(true);
  });
});

describe("VaultCore records", () => {
  it("seals and opens records of a kind, only once unlocked", async () => {
    const { vault } = await setUp();
    const [sealed] = await vault.seal({ kind: "tie", records: [{ id: "t1", title: "Floor", notes: " Went well " }] });
    expect(sealed.notes.startsWith("e1.")).toBe(true);
    expect(await vault.open({ kind: "tie", records: [sealed] })).toEqual([{ id: "t1", title: "Floor", notes: "Went well" }]);
    vault.lock();
    await expect(vault.open({ kind: "tie", records: [sealed] })).rejects.toThrow("Your journal is locked.");
  });

  it("searches ties' opened notes, fetching the index once until told to forget it", async () => {
    let loads = 0;
    /** @type {any[]} */
    let index = [];
    const vault = new VaultCore(async () => { loads++; return index; });
    await vault.setup({ userId: USER, code: newCode() });
    const [floor, susp] = await vault.seal({ kind: "tie", records: [
      { id: "a", title: "Floor", notes: "Öse and hip harness", plan_titles: [] },
      { id: "b", title: "Suspension", notes: null, plan_titles: ["TK"] },
    ] });
    index = [floor, susp];
    expect(await vault.searchTies({ q: "öse" })).toEqual(["a"]);
    expect(await vault.searchTies({ q: "tk" })).toEqual(["b"]);
    expect(loads).toBe(1);
    vault.forgetSearch();
    await vault.searchTies({ q: "x" });
    expect(loads).toBe(2);
  });

  it("seals a share with a new key of its own, which opens it in someone else's vault, only once unlocked", async () => {
    const { vault } = await setUp();
    const id = newShareId();
    const { key, body } = await vault.sealShare({ id, kind: "tie", data: { title: "Floor session" } });
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const theirs = (await setUp()).vault;
    expect(await theirs.openShare({ id, kind: "tie", key, sealed: body.slice(0) })).toEqual({ title: "Floor session" });
    await expect(theirs.openShare({ id, kind: "plan", key, sealed: body.slice(0) })).rejects.toThrow(CantOpen);
    theirs.lock();
    await expect(theirs.openShare({ id, kind: "tie", key, sealed: body.slice(0) })).rejects.toThrow("locked");
    await expect(new VaultCore().sealShare({ id, kind: "tie", data: {} })).rejects.toThrow("locked");
  });
});

describe("photos in shares", () => {
  const PHOTO = "0b6e1f2c-3d4a-4b5c-8d6e-7f8091a2b3c4";
  const FILE = "2b6e1f2c-3d4a-4b5c-8d6e-7f8091a2b3c4";
  const ADOPTED = "3b6e1f2c-3d4a-4b5c-8d6e-7f8091a2b3c4";

  /**
   * A vault whose photos are the objects in store, as the server would
   * hand back their parts.
   * @param {string} userId
   * @param {Map<string, { body: ArrayBuffer, thumbBytes: number }>} store
   * @param {(fileId: string, part: "thumb" | "full") => Promise<ArrayBuffer>} [loadShareFile]
   */
  async function vaultWith(userId, store, loadShareFile) {
    /** @param {{ body: ArrayBuffer, thumbBytes: number } | undefined} o @param {"thumb" | "full"} part */
    const part = (o, part) => {
      if (!o) throw new Error("not there");
      return part === "thumb" ? o.body.slice(0, o.thumbBytes) : o.body.slice(o.thumbBytes);
    };
    const vault = new VaultCore(undefined, async (id, p) => part(store.get(id), p),
      loadShareFile && ((_shareId, fileId, p) => loadShareFile(fileId, p)));
    await vault.setup({ userId, code: newCode() });
    return { vault, part };
  }

  it("go from one journal to another through the share, opened only in the Workers", async () => {
    for (const kind of /** @type {const} */ (["photo", "video"])) {
      const mine = new Map();
      const sender = await vaultWith(USER, mine);
      // A video over one piece, so its pieces are checked too.
      const full = new Uint8Array(kind === "video" ? 1024 * 1024 + 5 : 300).map((_, i) => i % 251);
      const sealCall = kind === "video" ? "sealVideo" : "sealPhoto";
      mine.set(PHOTO, await sender.vault[sealCall]({ mediaId: PHOTO, thumb: new Uint8Array([7, 7]).buffer, full: full.slice().buffer }));

      const shareId = newShareId();
      const key = (await sender.vault.sealShare({ id: shareId, kind: "tie", data: {} })).key;
      const shared = new Map([[FILE, await sender.vault.reshareMedia({ shareId, key, fileId: FILE, mediaId: PHOTO, kind })]]);

      const theirs = new Map();
      const recipient = await vaultWith("user-2", theirs, async (fileId, p) => sender.part(shared.get(fileId), p));
      expect([...new Uint8Array(await recipient.vault.openShareThumb({ shareId, key, fileId: FILE, kind }))]).toEqual([7, 7]);
      theirs.set(ADOPTED, await recipient.vault.adoptShareFile({ shareId, key, fileId: FILE, kind, mediaId: ADOPTED }));
      expect(new Uint8Array(await recipient.vault.openPhoto({ mediaId: ADOPTED, part: "full", kind }))).toEqual(full);

      // Not with another link's key, or as another file.
      await expect(recipient.vault.openShareThumb({ shareId, key: (await sender.vault.sealShare({ id: shareId, kind: "tie", data: {} })).key, fileId: FILE, kind }))
        .rejects.toThrow(CantOpen);
      await expect(recipient.vault.adoptShareFile({ shareId: newShareId(), key, fileId: FILE, kind, mediaId: ADOPTED }))
        .rejects.toThrow(CantOpen);
    }
  });

  it("need the journal unlocked", async () => {
    const vault = new VaultCore();
    await expect(vault.adoptShareFile({ shareId: newShareId(), key: "x", fileId: FILE, kind: "photo", mediaId: ADOPTED }))
      .rejects.toThrow("locked");
    await expect(vault.openShareThumb({ shareId: newShareId(), key: "x", fileId: FILE, kind: "photo" })).rejects.toThrow("locked");
  });
});
