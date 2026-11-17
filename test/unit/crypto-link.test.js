// What both devices agree on when signing in on a new one (public/js/crypto/link.js).
import { describe, it, expect } from "vitest";
import {
  linkBinding, keyHash, linkNumber, numberChoices, linkAddress, readLinkFragment, sealLinkKey, openLinkKey,
} from "../../public/js/crypto/link.js";
import { newIdentity } from "../../public/js/crypto/identity.js";
import { CantOpen } from "../../public/js/crypto/fields.js";

const ID = "0b6e7a52-5e0c-4f8e-9d55-0d1b8c1d2e3f";
const HASH = "A".repeat(43);

describe("link codes", () => {
  it("binds the key to the account and the request", () => {
    expect(linkBinding("u1", ID)).toBe(`notonawa|link|v1|u1|${ID}`);
  });

  it("hashes the public key as base64url SHA-256, and the same key gives the same number", async () => {
    const { publicKey } = await newIdentity();
    const hash = await keyHash(publicKey);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await keyHash(publicKey)).toBe(hash);
    expect(linkNumber(hash)).toBe(linkNumber(hash));
  });

  it("numbers are 10 to 99", () => {
    expect(linkNumber(HASH)).toBe(10); // all zero bytes
    expect(linkNumber("__" + "A".repeat(41))).toBeLessThanOrEqual(99);
    for (let i = 0; i < 200; i++) {
      const n = linkNumber(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
      expect(n >= 10 && n <= 99).toBe(true);
    }
  });

  it("offers three different numbers, one of them the right one", () => {
    for (let i = 0; i < 50; i++) {
      const choices = numberChoices(47);
      expect(choices).toHaveLength(3);
      expect(new Set(choices).size).toBe(3);
      expect(choices).toContain(47);
      expect(choices.every((n) => n >= 10 && n <= 99)).toBe(true);
    }
  });

  it("reads back the link it makes, and nothing else", () => {
    const link = linkAddress("https://notonawa.app", ID, HASH);
    expect(link).toBe(`https://notonawa.app/link#${ID}.${HASH}`);
    expect(readLinkFragment(link.slice(link.indexOf("#")))).toEqual({ id: ID, keyHash: HASH });
    for (const bad of ["", "#", `#${ID}`, `#${ID}.${HASH}.x`, `#${ID}.${HASH.slice(1)}`, `#not-an-id.${HASH}`, `#${ID}.${"A".repeat(42)}+`]) {
      expect(readLinkFragment(bad), bad).toBeNull();
    }
  });

  it("seals a data key that only that key pair opens, for that binding", async () => {
    const { seed, publicKey } = await newIdentity();
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const binding = linkBinding("u1", ID);
    const sealed = await sealLinkKey(raw, publicKey, binding);
    expect(sealed).toMatch(/^[A-Za-z0-9_-]{1558}$/); // the length src/link/parse.js expects
    expect(await openLinkKey(seed, sealed, binding)).toEqual(raw);
    await expect(openLinkKey(seed, sealed, linkBinding("u2", ID))).rejects.toThrow(CantOpen);
    await expect(openLinkKey((await newIdentity()).seed, sealed, binding)).rejects.toThrow(CantOpen);
    await expect(sealLinkKey(raw.slice(1), publicKey, binding)).rejects.toThrow();
  });

  it("the public key is the length src/link/parse.js expects", async () => {
    const { publicKey } = await newIdentity();
    const text = btoa(String.fromCharCode(...publicKey)).replace(/=+$/, "");
    expect(text).toHaveLength(1622);
  });
});
