// Signing in on a new device in the crypto Worker (public/js/crypto/vault-core.js's link operations).
import { describe, it, expect } from "vitest";
import { VaultCore } from "../../public/js/crypto/vault-core.js";
import { WrongSecret } from "../../public/js/crypto/keys.js";
import { CantOpen } from "../../public/js/crypto/fields.js";
import { newRecoveryCode, readRecoveryCode } from "../../public/js/recovery.js";

const USER = "user-1";
const REQUEST = "0b6e7a52-5e0c-4f8e-9d55-0d1b8c1d2e3f";
const newPrf = () => crypto.getRandomValues(new Uint8Array(32));
const give = (/** @type {Uint8Array} */ bytes) => bytes.slice().buffer;
const newCode = () => /** @type {string} */ (readRecoveryCode(newRecoveryCode()));

async function setUp() {
  const phone = new VaultCore();
  const prf = newPrf();
  const code = newCode();
  const wraps = await phone.setup({ userId: USER, code, prf: give(prf) });
  const proof = { wrap: /** @type {any} */ (wraps.passkey), secret: { prf: give(prf) } };
  return { phone, prf, code, wraps, proof };
}

/** Whether two vaults hold the same key: one opens what the other sealed. */
async function sameKey(/** @type {VaultCore} */ a, /** @type {VaultCore} */ b) {
  const [sealed] = await a.seal({ kind: "tie", records: [{ id: "t1", title: "Floor", notes: "Went well" }] });
  return (await b.open({ kind: "tie", records: [sealed] }))[0].notes === "Went well";
}

describe("VaultCore: signing in on a new device", () => {
  it("hands the key to the new device, which wraps it for its passkey and unlocks", async () => {
    const { phone, proof } = await setUp();
    const laptop = new VaultCore();
    const { publicKey, keyHash } = await laptop.linkStart();
    const sealed = await phone.linkSeal({ userId: USER, requestId: REQUEST, publicKey, keyHash, proof });
    expect(laptop.unlocked).toBe(false);

    await laptop.linkOpen({ userId: USER, requestId: REQUEST, sealed });
    const laptopPrf = newPrf();
    const { wrap } = await laptop.linkTake({ prf: give(laptopPrf) });
    expect(laptop.unlocked).toBe(true);
    expect(await sameKey(phone, laptop)).toBe(true);

    // Its new wrap unlocks it next time, with the same key (the id key too).
    const later = new VaultCore();
    await later.unlock({ userId: USER, wrap: /** @type {any} */ (wrap), secret: { prf: give(laptopPrf) } });
    expect(await sameKey(phone, later)).toBe(true);
    expect(await later.recordIds({ self: true })).toEqual(await phone.recordIds({ self: true }));
  });

  it("unlocks without a wrap when the new passkey gives no PRF output", async () => {
    const { phone, proof } = await setUp();
    const laptop = new VaultCore();
    const { publicKey, keyHash } = await laptop.linkStart();
    await laptop.linkOpen({ userId: USER, requestId: REQUEST, sealed: await phone.linkSeal({ userId: USER, requestId: REQUEST, publicKey, keyHash, proof }) });
    expect(await laptop.linkTake({})).toEqual({ wrap: null });
    expect(await sameKey(phone, laptop)).toBe(true);
  });

  it("needs proof to seal the key, even when unlocked", async () => {
    const { phone, wraps } = await setUp();
    const { publicKey, keyHash } = await new VaultCore().linkStart();
    await expect(phone.linkSeal({ userId: USER, requestId: REQUEST, publicKey, keyHash, proof: { wrap: wraps.recovery, secret: { code: newCode() } } }))
      .rejects.toThrow(WrongSecret);
  });

  it("refuses a public key that isn't the one the code's hash is for", async () => {
    const { phone, proof } = await setUp();
    const { keyHash } = await new VaultCore().linkStart();
    const { publicKey: other } = await new VaultCore().linkStart();
    await expect(phone.linkSeal({ userId: USER, requestId: REQUEST, publicKey: other, keyHash, proof })).rejects.toThrow("doesn't match");
  });

  it("opens only for the account and request it was sealed for, and only on the device that started it", async () => {
    const { phone, proof } = await setUp();
    const laptop = new VaultCore();
    const { publicKey, keyHash } = await laptop.linkStart();
    const sealed = await phone.linkSeal({ userId: USER, requestId: REQUEST, publicKey, keyHash, proof });
    await expect(laptop.linkOpen({ userId: "user-2", requestId: REQUEST, sealed })).rejects.toThrow(CantOpen);
    await expect(laptop.linkOpen({ userId: USER, requestId: crypto.randomUUID(), sealed })).rejects.toThrow(CantOpen);
    await expect(new VaultCore().linkOpen({ userId: USER, requestId: REQUEST, sealed })).rejects.toThrow("ended");
    // Starting again forgets the old key pair.
    await laptop.linkStart();
    await expect(laptop.linkOpen({ userId: USER, requestId: REQUEST, sealed })).rejects.toThrow(CantOpen);
  });

  it("forgets a link in progress on lock", async () => {
    const { phone, proof } = await setUp();
    const laptop = new VaultCore();
    const { publicKey, keyHash } = await laptop.linkStart();
    const sealed = await phone.linkSeal({ userId: USER, requestId: REQUEST, publicKey, keyHash, proof });
    await laptop.linkOpen({ userId: USER, requestId: REQUEST, sealed });
    laptop.lock();
    await expect(laptop.linkTake({ prf: give(newPrf()) })).rejects.toThrow("ended");
  });
});
