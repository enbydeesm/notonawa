// The crypto Worker's format 2 operations (public/js/crypto/vault-core.js):
// records, v3 files, identity keys and contacts' messages. Whole records
// and files only, of known kinds; keys leave only sealed or in a record.
import { describe, it, expect } from "vitest";
import { VaultCore } from "../../public/js/crypto/vault-core.js";
import { newRecoveryCode, readRecoveryCode } from "../../public/js/recovery.js";
import { newShareId, newShareKey } from "../../public/js/crypto/share.js";
import { newPairKey } from "../../public/js/crypto/pair.js";
import { toBase64url } from "../../public/js/crypto/keys.js";
import { CantOpen } from "../../public/js/crypto/fields.js";
import { BadRecord } from "../../public/js/records/schema.js";

const USER = "user-1";
const give = (/** @type {Uint8Array} */ bytes) => bytes.slice().buffer;
const newCode = () => /** @type {string} */ (readRecoveryCode(newRecoveryCode()));
const TIE = { tie_date: "2026-11-13", tie_type: "floor", title: "Futomomo", notes: "secret" };

/** @param {ConstructorParameters<typeof VaultCore>} loaders */
async function setUp(...loaders) {
  const vault = new VaultCore(...loaders);
  const prf = crypto.getRandomValues(new Uint8Array(32));
  const code = newCode();
  const wraps = await vault.setup({ userId: USER, code, prf: give(prf) });
  return { vault, prf, code, wraps };
}

describe("record ids", () => {
  it("are the same after unlocking again, with the passkey or the recovery code", async () => {
    const { vault, prf, code, wraps } = await setUp();
    const ask = { converted: [{ table: "ties", oldId: 7 }], self: true };
    const first = await vault.recordIds(ask);
    vault.lock();
    await vault.unlock({ userId: USER, wrap: /** @type {any} */ (wraps.passkey), secret: { prf: give(prf) } });
    expect(await vault.recordIds(ask)).toEqual(first);
    const other = new VaultCore();
    await other.unlock({ userId: USER, wrap: wraps.recovery, secret: { code } });
    expect(await other.recordIds(ask)).toEqual(first);
    expect(first.self).not.toBe(first.converted[0]);
  });

  it("differ between accounts, and need the journal unlocked", async () => {
    const a = (await setUp()).vault;
    const b = (await setUp()).vault;
    expect((await a.recordIds({ self: true })).self).not.toBe((await b.recordIds({ self: true })).self);
    a.lock();
    await expect(a.recordIds({ self: true })).rejects.toThrow(/locked/);
  });
});

describe("records", () => {
  it("seal under a new item key, and open whole", async () => {
    const { vault } = await setUp();
    const [row] = await vault.sealRecords({ records: [{ kind: "tie", id: "t1", version: 1, body: TIE }] });
    expect(row.key).toMatch(/^k2\./);
    expect(row.body).toMatch(/^e2\./);
    expect(row.body).not.toContain("Futomomo");
    const [opened] = await vault.openRecords({ rows: [row] });
    expect(opened).toEqual({ kind: "tie", id: "t1", version: 1, key: row.key, body: { v: 2, ...TIE } });
  });

  it("keep their item key when saved again, at the next version", async () => {
    const { vault } = await setUp();
    const [first] = await vault.sealRecords({ records: [{ kind: "tie", id: "t1", version: 1, body: TIE }] });
    const [second] = await vault.sealRecords({ records: [{ kind: "tie", id: "t1", version: 2, key: first.key, body: { ...TIE, title: "Ebi" } }] });
    expect(second.key).toBe(first.key);
    expect((await vault.openRecords({ rows: [second] }))[0].body?.title).toBe("Ebi");
  });

  it("come back unreadable, not failing the rest, if a body is moved, an old version served or the kind unknown", async () => {
    const { vault } = await setUp();
    const [a, b] = await vault.sealRecords({ records: [
      { kind: "tie", id: "t1", version: 1, body: TIE }, { kind: "tie", id: "t2", version: 1, body: TIE },
    ] });
    const opened = await vault.openRecords({ rows: [
      a, { ...b, body: a.body }, { ...a, version: 2 }, { ...a, kind: "ties" }, { ...a, key: b.key },
    ] });
    expect(opened.map((r) => r.unreadable ?? false)).toEqual([false, true, true, true, true]);
    expect(opened.slice(1).every((r) => r.body === null)).toBe(true);
  });

  it("are checked before they're sealed, and only of known kinds", async () => {
    const { vault } = await setUp();
    await expect(vault.sealRecords({ records: [{ kind: "tie", id: "t1", version: 1, body: { title: "No date" } }] })).rejects.toThrow(BadRecord);
    await expect(vault.sealRecords({ records: [{ kind: /** @type {any} */ ("ties"), id: "t1", version: 1, body: {} }] })).rejects.toThrow();
  });

  it("don't open another account's", async () => {
    const [row] = await (await setUp()).vault.sealRecords({ records: [{ kind: "tie", id: "t1", version: 1, body: TIE }] });
    expect((await (await setUp()).vault.openRecords({ rows: [row] }))[0].unreadable).toBe(true);
  });

  it("have no general decrypt: only whole records, and only these operations", () => {
    const names = Object.getOwnPropertyNames(VaultCore.prototype);
    for (const op of ["sealRecords", "openRecords", "sealFile", "openFile", "copyFile", "makeIdentity", "openIdentity",
      "sealAcceptance", "openAcceptance", "sealMessage", "openMessage", "recordIds"]) {
      expect(names).toContain(op);
    }
    expect(names.filter((n) => /decrypt|unwrap|export|key$/i.test(n))).toEqual([]);
  });
});

describe("v3 files", () => {
  it("seal under a new key of their own, and open by id with it", async () => {
    /** @type {Map<string, ArrayBuffer>} */
    const stored = new Map();
    const { vault } = await setUp(undefined, undefined, undefined, async (fileId, part) => /** @type {ArrayBuffer} */ (stored.get(`${fileId}/${part}`)));
    const thumb = new Uint8Array([1, 2, 3]).buffer;
    const full = new Uint8Array([4, 5, 6, 7]).buffer;
    const sealed = await vault.sealFile({ fileId: "f1", thumb, full });
    expect(sealed.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    stored.set("f1/thumb", sealed.body.slice(0, sealed.thumbBytes));
    stored.set("f1/full", sealed.body.slice(sealed.thumbBytes));
    expect([...new Uint8Array(await vault.openFile({ fileId: "f1", key: sealed.key, part: "full" }))]).toEqual([4, 5, 6, 7]);
    await expect(vault.openFile({ fileId: "f1", key: (await vault.sealFile({ fileId: "x", thumb, full })).key, part: "full" }))
      .rejects.toThrow(CantOpen);

    const copy = await vault.copyFile({ fileId: "f1", key: sealed.key, newFileId: "f2" });
    expect(copy.key).not.toBe(sealed.key);
    stored.set("f2/thumb", copy.body.slice(0, copy.thumbBytes));
    expect([...new Uint8Array(await vault.openFile({ fileId: "f2", key: copy.key, part: "thumb" }))]).toEqual([1, 2, 3]);
  });
});

describe("identity and contacts", () => {
  it("make an identity whose seed leaves only sealed, and open it again after unlocking", async () => {
    const { vault, code, wraps } = await setUp();
    const identity = await vault.makeIdentity();
    expect(identity.sealedSeed).toMatch(/^i1\./);
    expect(Object.keys(identity).sort()).toEqual(["publicKey", "sealedSeed"]);
    const again = new VaultCore();
    await again.unlock({ userId: USER, wrap: wraps.recovery, secret: { code } });
    await expect(again.openIdentity(identity)).resolves.toBeNull();
    const other = await (await setUp()).vault.makeIdentity();
    await expect(again.openIdentity({ publicKey: other.publicKey, sealedSeed: identity.sealedSeed })).rejects.toThrow(CantOpen);
  });

  it("carry an acceptance from the accepter to the inviter, for that share and link", async () => {
    const inviter = (await setUp()).vault;
    const accepter = (await setUp()).vault;
    const { publicKey } = await inviter.makeIdentity();
    const shareId = newShareId();
    const linkKey = toBase64url(newShareKey());
    const payload = { pairKey: newPairKey(), mailbox: "mb-1" };
    const sealed = await accepter.sealAcceptance({ inviterPublicKey: publicKey, shareId, linkKey, payload });
    expect(await inviter.openAcceptance({ shareId, linkKey, sealed })).toEqual(payload);
    await expect(inviter.openAcceptance({ shareId, linkKey: toBase64url(newShareKey()), sealed })).rejects.toThrow(CantOpen);
    await expect(accepter.openAcceptance({ shareId, linkKey, sealed })).rejects.toThrow(/identity key first/);
  });

  it("send messages sealed with the pair key", async () => {
    const { vault } = await setUp();
    const pairKey = newPairKey();
    const sealed = await vault.sealMessage({ pairKey, mailboxId: "mb-1", counter: 1, payload: { type: "removed" } });
    expect(await vault.openMessage({ pairKey, mailboxId: "mb-1", sealed })).toEqual({ counter: 1, payload: { type: "removed" } });
  });

  it("forget the identity on lock", async () => {
    const { vault, code, wraps } = await setUp();
    const { publicKey } = await vault.makeIdentity();
    const shareId = newShareId();
    const linkKey = toBase64url(newShareKey());
    const sealed = await (await setUp()).vault.sealAcceptance({ inviterPublicKey: publicKey, shareId, linkKey, payload: {} });
    vault.lock();
    await vault.unlock({ userId: USER, wrap: wraps.recovery, secret: { code } });
    await expect(vault.openAcceptance({ shareId, linkKey, sealed })).rejects.toThrow(/identity key first/);
  });
});
