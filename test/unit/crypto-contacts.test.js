// What contacts are built on: identity keys (public/js/crypto/identity.js),
// the acceptance and pair-key messages (pair.js), and safety numbers
// (safety-number.js). HPKE itself is checked against the draft's vector in
// hpke.test.js; these pin our formats around it.
import { describe, it, expect } from "vitest";
import { CipherSuite, KEM_MLKEM768_X25519, KDF_HKDF_SHA256, AEAD_AES_256_GCM } from "../../public/js/vendor/hpke.js";
import {
  newIdentity, sealSeed, openSeed, sealTo, openWith, seedData, PUBLIC_KEY_BYTES, SEED_BYTES, ENC_BYTES,
} from "../../public/js/crypto/identity.js";
import {
  sealAcceptance, openAcceptance, newPairKey, sealMessage, openMessage, acceptCounter, messageData, acceptanceData,
} from "../../public/js/crypto/pair.js";
import { safetyNumber, fingerprintHalf, safetyBlocks, ITERATIONS } from "../../public/js/crypto/safety-number.js";
import { CantOpen } from "../../public/js/crypto/fields.js";
import { newDataKey } from "../../public/js/crypto/keys.js";
import { newShareKey, newShareId } from "../../public/js/crypto/share.js";

/**
 * @param {number} n
 * @param {number} start
 */
const seq = (n, start) => /** @type {Uint8Array<ArrayBuffer>} */ (Uint8Array.from({ length: n }, (_, i) => (start + i) & 255));
/** @param {string} hex */
const fromHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
/** @param {Uint8Array} b */
const b64 = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const text = (/** @type {string} */ s) => new TextEncoder().encode(s);
const USER = "user-1";

/** The key pair DeriveKeyPair makes from 30 31 … 4f, for fixed vectors. */
async function fixedIdentity() {
  const suite = new CipherSuite(KEM_MLKEM768_X25519, KDF_HKDF_SHA256, AEAD_AES_256_GCM);
  const pair = await suite.DeriveKeyPair(seq(32, 0x30), true);
  return {
    seed: /** @type {Uint8Array<ArrayBuffer>} */ (await suite.SerializePrivateKey(pair.privateKey)),
    publicKey: /** @type {Uint8Array<ArrayBuffer>} */ (await suite.SerializePublicKey(pair.publicKey)),
  };
}

describe("identity keys", () => {
  it("seal the seed to exactly this, bound to the user and the public key's hash", async () => {
    const { seed, publicKey } = await fixedIdentity();
    expect(b64(seed)).toBe("yC8ewFEpsD1gVNb-jSQlbQHXB3shYC3UGqnnrGb2moI");
    expect(await seedData(USER, publicKey)).toBe("notonawa|identity|v1|user-1|h0SKK20QQ_IshAmojTW7Ba7Suy4wQOse0g73bDUYhAM");
    const dataKey = await crypto.subtle.importKey("raw", seq(32, 0), "AES-GCM", false, ["encrypt", "decrypt"]);
    const sealed = await sealSeed(dataKey, { userId: USER, publicKey, seed }, { iv: seq(12, 0x60) });
    expect(sealed).toBe("i1.YGFiY2RlZmdoaWpr.IvSFleppM1IcQi_V_6nkLieijvKlBB8NuQhnwBoEbYrhJ3mFp9aTGzProIB4rVJ_");
    expect(b64(await openSeed(dataKey, { userId: USER, publicKey }, sealed))).toBe(b64(seed));
  });

  it("are a 32-byte seed and a 1,216-byte public key, new each time", async () => {
    const a = await newIdentity();
    expect([a.seed.length, a.publicKey.length]).toEqual([SEED_BYTES, PUBLIC_KEY_BYTES]);
    expect(b64(a.publicKey)).not.toBe(b64((await newIdentity()).publicKey));
  });

  it("open their seed only for their user, public key and data key", async () => {
    const dataKey = await newDataKey();
    const { seed, publicKey } = await newIdentity();
    const sealed = await sealSeed(dataKey, { userId: USER, publicKey, seed });
    const other = (await newIdentity()).publicKey;
    await expect(openSeed(dataKey, { userId: "user-2", publicKey }, sealed)).rejects.toThrow(CantOpen);
    await expect(openSeed(dataKey, { userId: USER, publicKey: other }, sealed)).rejects.toThrow(CantOpen);
    await expect(openSeed(await newDataKey(), { userId: USER, publicKey }, sealed)).rejects.toThrow(CantOpen);
    for (const bad of ["e2.a.b", "i1.x", null]) await expect(openSeed(dataKey, { userId: USER, publicKey }, bad)).rejects.toThrow(CantOpen);
  });

  it("seal to a public key: only its seed opens it, bound to what it's for", async () => {
    const me = await newIdentity();
    const sealed = await sealTo(me.publicKey, text("hello"), "notonawa|test|v1");
    expect(sealed.length).toBe(ENC_BYTES + 5 + 16);
    expect(new TextDecoder().decode(await openWith(me.seed, sealed, "notonawa|test|v1"))).toBe("hello");
    await expect(openWith((await newIdentity()).seed, sealed, "notonawa|test|v1")).rejects.toThrow(CantOpen);
    await expect(openWith(me.seed, sealed, "notonawa|test|v2")).rejects.toThrow(CantOpen);
    const changed = sealed.slice();
    changed[ENC_BYTES + 1] ^= 1;
    await expect(openWith(me.seed, changed, "notonawa|test|v1")).rejects.toThrow(CantOpen);
    await expect(openWith(me.seed, sealed.slice(0, ENC_BYTES), "notonawa|test|v1")).rejects.toThrow(CantOpen);
  });
});

describe("the acceptance", () => {
  /** @returns {Promise<{ inviter: Awaited<ReturnType<typeof newIdentity>>, shareId: string, linkKey: Uint8Array<ArrayBuffer> }>} */
  const invite = async () => ({ inviter: await newIdentity(), shareId: newShareId(), linkKey: newShareKey() });

  it("opens for the inviter, for that share, with the link's key", async () => {
    const { inviter, shareId, linkKey } = await invite();
    const payload = { publicKey: "…", mailbox: "mb-1", token: "t", pairKey: newPairKey() };
    const sealed = await sealAcceptance({ inviterPublicKey: inviter.publicKey, shareId, linkKey, payload });
    expect(await openAcceptance({ seed: inviter.seed, shareId, linkKey, sealed })).toEqual(payload);
  });

  it("is refused from someone without the link (the server has the public key, not the link's key)", async () => {
    const { inviter, shareId, linkKey } = await invite();
    const forged = await sealAcceptance({ inviterPublicKey: inviter.publicKey, shareId, linkKey: newShareKey(), payload: { x: 1 } });
    await expect(openAcceptance({ seed: inviter.seed, shareId, linkKey, sealed: forged })).rejects.toThrow(CantOpen);
  });

  it("is refused for another share, or by anyone but the inviter", async () => {
    const { inviter, shareId, linkKey } = await invite();
    const sealed = await sealAcceptance({ inviterPublicKey: inviter.publicKey, shareId, linkKey, payload: { x: 1 } });
    await expect(openAcceptance({ seed: inviter.seed, shareId: newShareId(), linkKey, sealed })).rejects.toThrow(CantOpen);
    await expect(openAcceptance({ seed: (await newIdentity()).seed, shareId, linkKey, sealed })).rejects.toThrow(CantOpen);
    expect(acceptanceData("abc")).toBe("notonawa|accept|v1|abc");
  });
});

describe("pair-key messages", () => {
  it("seal to exactly this: the counter in the clear, bound with the mailbox", async () => {
    const sealed = await sealMessage(b64(seq(32, 0x70)), { mailboxId: "mb-1", counter: 3 }, { type: "removed" }, { iv: seq(12, 0x90) });
    expect(sealed).toBe("m1.3.kJGSk5SVlpeYmZqb.X5MVPS4oBwBRKJxSaQcxP3DWn41rqt1MqOYfGZwFr9-k_A");
    expect(await openMessage(b64(seq(32, 0x70)), "mb-1", sealed)).toEqual({ counter: 3, payload: { type: "removed" } });
    expect(messageData("mb-1", 3)).toBe("notonawa|msg|v1|mb-1|3");
  });

  it("open only with the pair key, in their mailbox, at their counter", async () => {
    const key = newPairKey();
    const sealed = await sealMessage(key, { mailboxId: "mb-1", counter: 1 }, { hi: true });
    await expect(openMessage(newPairKey(), "mb-1", sealed)).rejects.toThrow(CantOpen);
    await expect(openMessage(key, "mb-2", sealed)).rejects.toThrow(CantOpen);
    await expect(openMessage(key, "mb-1", sealed.replace(/^m1\.1\./, "m1.2."))).rejects.toThrow(CantOpen);
    for (const bad of ["m1.0.a.b", "m1.-1.a.b", "m1.01.a.b", "e2.1.a.b", "m1.1.a", null]) {
      await expect(openMessage(key, "mb-1", bad)).rejects.toThrow(CantOpen);
    }
  });

  it("aren't taken again: a counter must be above the last one taken", () => {
    expect(acceptCounter(0, 1)).toBe(true);
    expect(acceptCounter(4, 5)).toBe(true);
    expect(acceptCounter(4, 9)).toBe(true);
    expect(acceptCounter(4, 4)).toBe(false);
    expect(acceptCounter(4, 2)).toBe(false);
    expect(acceptCounter(0, NaN)).toBe(false);
  });

  it("need a counter from 1", async () => {
    await expect(sealMessage(newPairKey(), { mailboxId: "mb-1", counter: 0 }, {})).rejects.toThrow();
  });
});

describe("safety numbers", () => {
  // libsignal's own vector (rust/protocol/src/fingerprint.rs: ALICE_IDENTITY,
  // BOB_IDENTITY, DISPLAYABLE_FINGERPRINT_V1, 5,200 iterations).
  const ALICE = { publicKey: fromHex("0506863bc66d02b40d27b8d49ca7c09e9239236f9d7d25d6fcca5ce13c7064d868"), id: "+14152222222" };
  const BOB = { publicKey: fromHex("05f781b6fb32fed9ba1cf2de978d4d5da28dc34046ae814402b5c0dbd96fda907b"), id: "+14153333333" };

  it("match Signal's published vector, from either side", async () => {
    expect(ITERATIONS).toBe(5200);
    expect(await safetyNumber(ALICE, BOB)).toBe("300354477692869396892869876765458257569162576843440918079131");
    expect(await safetyNumber(BOB, ALICE)).toBe("300354477692869396892869876765458257569162576843440918079131");
  });

  it("match Python's hashlib on X-Wing-sized keys", async () => {
    const a = { publicKey: Uint8Array.from({ length: 1216 }, (_, i) => i & 255), id: "user-1" };
    const b = { publicKey: Uint8Array.from({ length: 1216 }, (_, i) => (i * 7 + 3) & 255), id: "user-2" };
    expect(await safetyNumber(a, b)).toBe("058666774415112403697846364605403871876429481387837480351432");
  });

  it("change with either key or id", async () => {
    const base = await safetyNumber(ALICE, BOB);
    const otherKey = ALICE.publicKey.slice();
    otherKey[5] ^= 1;
    expect(await safetyNumber({ ...ALICE, publicKey: otherKey }, BOB)).not.toBe(base);
    expect(await safetyNumber({ ...ALICE, id: "+14152222223" }, BOB)).not.toBe(base);
  });

  it("are shown as 12 blocks of 5", async () => {
    expect(safetyBlocks("300354477692869396892869876765458257569162576843440918079131")).toEqual([
      "30035", "44776", "92869", "39689", "28698", "76765", "45825", "75691", "62576", "84344", "09180", "79131",
    ]);
    expect((await fingerprintHalf(ALICE.publicKey, ALICE.id)).length).toBe(30);
  });
});
