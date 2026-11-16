// Sealed records and item keys (public/js/crypto/records.js) and record ids
// (public/js/records/ids.js), format 2. The fixed vectors pin the formats:
// with these keys and IVs the output must be exactly this. The ids' were
// also worked out with Python's hmac and hashlib (HKDF by hand), not only
// WebCrypto.
import { describe, it, expect } from "vitest";
import {
  newItemKey, openItemKey, sealBody, openBody, pad, itemKeyData, bodyData, TooBig, PAD_BYTES, MAX_BODY_BYTES, RECORD_KINDS,
} from "../../public/js/crypto/records.js";
import { CantOpen } from "../../public/js/crypto/fields.js";
import { idKeyFrom, convertedId, selfId, settingsId, newId, uuidFrom } from "../../public/js/records/ids.js";
import { newDataKey, wrapDataKey, unwrapKeyMaterial, keyMaterialOf } from "../../public/js/crypto/keys.js";

/**
 * n bytes counting up from start.
 * @param {number} n
 * @param {number} start
 */
const seq = (n, start) => /** @type {Uint8Array<ArrayBuffer>} */ (Uint8Array.from({ length: n }, (_, i) => (start + i) & 255));
const USER = "user-1";
const TIE = { userId: USER, kind: /** @type {const} */ ("tie"), id: "4f1c2a3b-5d6e-4f70-8192-a3b4c5d6e7f8" };

const fixedDataKey = () => crypto.subtle.importKey("raw", seq(32, 0), "AES-GCM", false, ["encrypt", "decrypt"]);
const fixedMaterial = () => crypto.subtle.importKey("raw", seq(32, 0), "HKDF", false, ["deriveKey"]);

/** @param {string} text */
const b64 = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

describe("fixed vectors", () => {
  // Data key 00 01 … 1f; item key 40 41 … 5f; item key's IV 80 … 8b; body's IV a0 … ab.
  const SEALED_KEY = "k2.gIGCg4SFhoeIiYqL.IOQsWAVXp9bWwl97Cj7kavcP56xe5VtddaTak-qhY6udfoBQxA2iXjE4AKpdwsBV";
  const BODY = "e2.oKGio6Slpqeoqaqr.rK1wHdjZsA8NBjWS7J4K1KligaiBAOhCwPDM7oCnIZw74xdh-nIWkdpsha9vwRb6wDEnRsvZMjD6UL3FUf71sKe5mjA-1sG5Fh8OTpc_d8uBOplkKn1iG9DeoXFKucSh2JRj7lJ36IvkAzJE7H52bnlS6r0PibNu5otEIb5s-6PC_PhMQBrqz7jqRmH00RWWqBhiTYp12R7VgkV4GuNThYkM-c4saDKEOcVvQ0deVa2vkjGtKHjZpWyt3FVv8IZ47bgaMnPFdyTOGPY_StIgcvSr3rF0FHTvOyDRkfuN2pkTRniuFenHE8loN3BdXobQ-wQDnULdOYyNUAK_DdMFChZ5N0xRhA1OVjL2JFWMiH8";

  it("seal an item key and a body to exactly these", async () => {
    const { sealed } = await newItemKey(await fixedDataKey(), TIE, { raw: seq(32, 0x40), iv: seq(12, 0x80) });
    expect(sealed).toBe(SEALED_KEY);
    const itemKey = await openItemKey(await fixedDataKey(), TIE, sealed);
    const body = await sealBody(itemKey, { ...TIE, version: 1 }, { title: "Futomomo", tie_date: "2026-11-13" }, { iv: seq(12, 0xa0) });
    expect(body).toBe(BODY);
  });

  it("open back to the body, padded to 256 bytes with spaces", async () => {
    const itemKey = await openItemKey(await fixedDataKey(), TIE, SEALED_KEY);
    expect(await openBody(itemKey, { ...TIE, version: 1 }, BODY)).toEqual({ v: 2, title: "Futomomo", tie_date: "2026-11-13" });
    // IV, then 256 bytes of padded JSON, then the 16-byte tag.
    expect(b64(BODY.split(".")[2]).length).toBe(256 + 16);
  });

  it("give these ids (HMAC-SHA256 under HKDF of the data key, as a version 8 UUID)", async () => {
    const idKey = await idKeyFrom(await fixedMaterial(), USER);
    expect(await convertedId(idKey, USER, "ties", 42)).toBe("ab29faf3-96d7-85ad-9fb9-f6783d3b68ee");
    expect(await selfId(idKey, USER)).toBe("21a97991-da6c-83f5-92fa-026be58461af");
    expect(await settingsId(idKey, USER)).toBe("0a33ddc9-cd98-8c2b-9fbb-bca0321a0953");
  });

  it("bind to these strings", () => {
    expect(itemKeyData(TIE)).toBe(`notonawa|itemkey|v2|user-1|tie|${TIE.id}`);
    expect(bodyData({ ...TIE, version: 3 })).toBe(`notonawa|record|v2|user-1|tie|${TIE.id}|3`);
  });
});

describe("item keys", () => {
  it("open only as their own record's, under their own data key", async () => {
    const dataKey = await newDataKey();
    const { sealed } = await newItemKey(dataKey, TIE);
    await expect(openItemKey(dataKey, TIE, sealed)).resolves.toBeTruthy();
    for (const other of [{ ...TIE, id: newId() }, { ...TIE, kind: /** @type {const} */ ("plan") }, { ...TIE, userId: "user-2" }]) {
      await expect(openItemKey(dataKey, other, sealed)).rejects.toThrow(CantOpen);
    }
    await expect(openItemKey(await newDataKey(), TIE, sealed)).rejects.toThrow(CantOpen);
  });

  it("are new each time, and never leave as anything but sealed", async () => {
    const dataKey = await newDataKey();
    const a = await newItemKey(dataKey, TIE);
    const b = await newItemKey(dataKey, TIE);
    expect(a.sealed).not.toBe(b.sealed);
    expect(a.key.extractable).toBe(false);
    expect((await openItemKey(dataKey, TIE, a.sealed)).extractable).toBe(false);
  });

  it("refuse what isn't one: another format, a cut tag, nonsense", async () => {
    const dataKey = await newDataKey();
    const { sealed } = await newItemKey(dataKey, TIE);
    const [, iv, ct] = sealed.split(".");
    for (const bad of [`e2.${iv}.${ct}`, `k2.${iv}.${ct.slice(0, 10)}`, `k2.${iv}`, "k2..", null, 42, "k2.!!.!!"]) {
      await expect(openItemKey(dataKey, TIE, bad)).rejects.toThrow(CantOpen);
    }
  });

  it("aren't made for an unknown kind or without an id", async () => {
    const dataKey = await newDataKey();
    await expect(newItemKey(dataKey, { ...TIE, kind: /** @type {any} */ ("ties") })).rejects.toThrow();
    await expect(newItemKey(dataKey, { ...TIE, id: "" })).rejects.toThrow();
  });
});

describe("bodies", () => {
  /** @returns {Promise<CryptoKey>} */
  const itemKey = async () => (await newItemKey(await newDataKey(), TIE)).key;

  it("open only as this record at this version", async () => {
    const key = await itemKey();
    const sealed = await sealBody(key, { ...TIE, version: 2 }, { title: "Ebi" });
    expect((await openBody(key, { ...TIE, version: 2 }, sealed)).title).toBe("Ebi");
    for (const other of [
      { ...TIE, version: 1 }, { ...TIE, version: 3 }, { ...TIE, id: newId(), version: 2 },
      { ...TIE, kind: /** @type {const} */ ("plan"), version: 2 }, { ...TIE, userId: "user-2", version: 2 },
    ]) {
      await expect(openBody(key, other, sealed)).rejects.toThrow(CantOpen);
    }
    await expect(openBody(await itemKey(), { ...TIE, version: 2 }, sealed)).rejects.toThrow(CantOpen);
  });

  it("are padded to a multiple of 256 bytes, so sizes say less", async () => {
    const key = await itemKey();
    for (const [length, padded] of [[0, 256], [200, 256], [300, 512], [1000, 1024]]) {
      const sealed = await sealBody(key, { ...TIE, version: 1 }, { notes: "x".repeat(length) });
      expect(b64(sealed.split(".")[2]).length - 16).toBe(padded);
    }
  });

  it("always say v: 2, whatever v they were given", async () => {
    const key = await itemKey();
    const sealed = await sealBody(key, { ...TIE, version: 1 }, { v: 1, title: "x" });
    expect(await openBody(key, { ...TIE, version: 1 }, sealed)).toEqual({ v: 2, title: "x" });
  });

  it("refuse a body that's too big, and a version under 1", async () => {
    const key = await itemKey();
    await expect(sealBody(key, { ...TIE, version: 1 }, { notes: "x".repeat(MAX_BODY_BYTES) })).rejects.toThrow(TooBig);
    await expect(sealBody(key, { ...TIE, version: 0 }, { title: "x" })).rejects.toThrow();
  });

  it("refuse a changed byte or another format", async () => {
    const key = await itemKey();
    const sealed = await sealBody(key, { ...TIE, version: 1 }, { title: "x" });
    const [, iv, ct] = sealed.split(".");
    const bytes = b64(ct);
    bytes[5] ^= 1;
    const changed = `e2.${iv}.${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    for (const bad of [changed, `e1.${iv}.${ct}`, `k2.${iv}.${ct}`]) {
      await expect(openBody(key, { ...TIE, version: 1 }, bad)).rejects.toThrow(CantOpen);
    }
  });

  it("pad with spaces only", () => {
    const padded = pad(/** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode('{"v":2}')));
    expect(padded.length).toBe(PAD_BYTES);
    expect(new TextDecoder().decode(padded).trimEnd()).toBe('{"v":2}');
  });

  it("cover every kind", () => {
    expect(RECORD_KINDS).toEqual(["tie", "plan", "person", "location", "workshop", "tag", "drawing", "pose", "pose_preset", "settings", "contact"]);
  });
});

describe("ids", () => {
  it("are the same on every device: from the data key, through any of its wraps", async () => {
    const dataKey = await newDataKey();
    const secret = /** @type {Uint8Array<ArrayBuffer>} */ (crypto.getRandomValues(new Uint8Array(32)));
    const other = /** @type {Uint8Array<ArrayBuffer>} */ (crypto.getRandomValues(new Uint8Array(32)));
    const wrapA = await wrapDataKey(dataKey, { userId: USER, kind: "passkey", secret });
    const wrapB = await wrapDataKey(dataKey, { userId: USER, kind: "passkey", secret: other });
    const ids = await Promise.all([
      keyMaterialOf(dataKey), unwrapKeyMaterial(wrapA, { userId: USER, secret }), unwrapKeyMaterial(wrapB, { userId: USER, secret: other }),
    ].map(async (m) => selfId(await idKeyFrom(await m, USER), USER)));
    expect(new Set(ids).size).toBe(1);
  });

  it("differ by user, table and old id, and with another data key", async () => {
    const material = await keyMaterialOf(await newDataKey());
    const idKey = await idKeyFrom(material, USER);
    const ids = [
      await convertedId(idKey, USER, "ties", 1), await convertedId(idKey, USER, "ties", 2),
      await convertedId(idKey, USER, "plans", 1), await convertedId(await idKeyFrom(material, "user-2"), "user-2", "ties", 1),
      await convertedId(await idKeyFrom(await keyMaterialOf(await newDataKey()), USER), USER, "ties", 1),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(await convertedId(idKey, USER, "ties", 1)).toBe(ids[0]);
  });

  it("are version 8 UUIDs, and new ones random", () => {
    const id = uuidFrom(new Uint8Array(32).fill(0xff).buffer);
    expect(id).toBe("ffffffff-ffff-8fff-bfff-ffffffffffff");
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("can't be had from material for anything but deriving keys", async () => {
    const material = await keyMaterialOf(await newDataKey());
    expect(material.extractable).toBe(false);
    expect(material.usages).toEqual(["deriveKey"]);
  });
});
