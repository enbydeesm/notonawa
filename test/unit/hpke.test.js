// The post-quantum public-key encryption contacts will use (X-Wing,
// MLKEM768-X25519, through hpke and @panva/hpke-noble).
//
// Two checks: the pinned packages against the draft's published test vector
// (draft-ietf-hpke-pq-05; there's none for our exact suite, so this one has
// ChaCha20Poly1305 where we use AES-256-GCM, which checks the KEM, the part
// that's new to us), and our own suite through the vendored bundle the pages
// load (public/js/vendor/hpke.js), the same code `vendor.mjs --check` keeps
// in step with node_modules.
import { describe, it, expect } from "vitest";
import * as HPKE from "hpke";
import { KEM_MLKEM768_X25519 as NOBLE_XWING, AEAD_ChaCha20Poly1305 } from "@panva/hpke-noble";
import {
  CipherSuite, KEM_MLKEM768_X25519, KDF_HKDF_SHA256, AEAD_AES_256_GCM,
} from "../../public/js/vendor/hpke.js";
import { vector } from "./hpke-xwing-vector.js";

/** @param {string} hex */
const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
/** @param {Uint8Array} b */
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const text = (/** @type {string} */ s) => new TextEncoder().encode(s);

describe("X-Wing against the published vector", () => {
  const suite = new HPKE.CipherSuite(NOBLE_XWING, HPKE.KDF_HKDF_SHA256, AEAD_ChaCha20Poly1305);

  it("is the suite the vector names", () => {
    expect([vector.mode, vector.kem_id, vector.kdf_id, vector.aead_id]).toEqual([0, 0x647a, 0x0001, 0x0003]);
    expect([suite.KEM.id, suite.KDF.id, suite.AEAD.id]).toEqual([0x647a, 0x0001, 0x0003]);
  });

  it("derives the vector's key pair: a 32-byte seed and a 1,216-byte public key", async () => {
    const pair = await suite.DeriveKeyPair(bytes(vector.ikmR), true);
    const sk = await suite.SerializePrivateKey(pair.privateKey);
    const pk = await suite.SerializePublicKey(pair.publicKey);
    expect(hex(sk)).toBe(vector.skRm);
    expect(hex(pk)).toBe(vector.pkRm);
    expect([sk.length, pk.length, bytes(vector.enc).length]).toEqual([32, 1216, 1120]);
  });

  it("opens the vector's first message from its encapsulated secret", async () => {
    const sk = await suite.DeserializePrivateKey(bytes(vector.skRm));
    const [first] = vector.encryptions;
    const opened = await suite.Open(sk, bytes(vector.enc), bytes(first.ct), {
      aad: bytes(first.aad), info: bytes(vector.info),
    });
    expect(hex(opened)).toBe(first.pt);
  });
});

describe("our suite, from the vendored bundle", () => {
  const suite = new CipherSuite(KEM_MLKEM768_X25519, KDF_HKDF_SHA256, AEAD_AES_256_GCM);
  const info = text("notonawa msg v1");
  const aad = text("notonawa|test|v1");

  it("is MLKEM768-X25519, HKDF-SHA256, AES-256-GCM", () => {
    expect([suite.KEM.id, suite.KDF.id, suite.AEAD.id]).toEqual([0x647a, 0x0001, 0x0002]);
    expect([suite.KEM.Nsk, suite.KEM.Npk, suite.KEM.Nenc]).toEqual([32, 1216, 1120]);
  });

  it("seals to a public key and opens with its private key", async () => {
    const pair = await suite.GenerateKeyPair();
    const { encapsulatedSecret, ciphertext } = await suite.Seal(pair.publicKey, text("hello"), { aad, info });
    expect(new TextDecoder().decode(await suite.Open(pair, encapsulatedSecret, ciphertext, { aad, info }))).toBe("hello");
  });

  it("gets the same key pair back from its 32-byte seed, as the sealed identity seed will", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const a = await suite.DeriveKeyPair(seed);
    const b = await suite.DeriveKeyPair(seed);
    expect(hex(await suite.SerializePublicKey(a.publicKey))).toBe(hex(await suite.SerializePublicKey(b.publicKey)));
    const { encapsulatedSecret, ciphertext } = await suite.Seal(a.publicKey, text("hi"), { info });
    expect(new TextDecoder().decode(await suite.Open(b, encapsulatedSecret, ciphertext, { info }))).toBe("hi");
  });

  it("refuses the wrong key, changed bytes, other additional data or info", async () => {
    const pair = await suite.GenerateKeyPair();
    const other = await suite.GenerateKeyPair();
    const { encapsulatedSecret, ciphertext } = await suite.Seal(pair.publicKey, text("hello"), { aad, info });
    const flip = (/** @type {Uint8Array} */ b, /** @type {number} */ i) => {
      const c = b.slice();
      c[i] ^= 1;
      return c;
    };
    await expect(suite.Open(other, encapsulatedSecret, ciphertext, { aad, info })).rejects.toThrow();
    await expect(suite.Open(pair, encapsulatedSecret, flip(ciphertext, 0), { aad, info })).rejects.toThrow();
    // Both halves of the hybrid: ML-KEM's ciphertext first, X25519's last 32 bytes.
    await expect(suite.Open(pair, flip(encapsulatedSecret, 0), ciphertext, { aad, info })).rejects.toThrow();
    await expect(suite.Open(pair, flip(encapsulatedSecret, 1119), ciphertext, { aad, info })).rejects.toThrow();
    await expect(suite.Open(pair, encapsulatedSecret, ciphertext, { aad: text("other"), info })).rejects.toThrow();
    await expect(suite.Open(pair, encapsulatedSecret, ciphertext, { aad, info: text("other") })).rejects.toThrow();
  });
});
