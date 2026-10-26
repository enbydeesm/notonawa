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
