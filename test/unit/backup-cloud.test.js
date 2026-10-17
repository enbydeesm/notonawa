import { describe, it, expect } from "vitest";
import { newBackupKeys, importPublicKey, sealBackup, openBackup } from "../../src/backup/crypto.js";
import { backupKey, expiredBackupKeys } from "../../src/backup/names.js";
import { backupToSql } from "../../scripts/backup-lib.mjs";

describe("sealed backups", () => {
  it("open only with the private key", async () => {
    const keys = await newBackupKeys();
    const other = await newBackupKeys();
    const { kty, n, e } = /** @type {JsonWebKey} */ (await crypto.subtle.exportKey("jwk", keys.publicKey));
    const publicKey = await importPublicKey(JSON.stringify({ kty, n, e, alg: "RSA-OAEP-256" }));
    const plain = new TextEncoder().encode("the whole journal");
    const sealed = await sealBackup(plain, publicKey);
    expect(new TextDecoder().decode(await openBackup(sealed, keys.privateKey))).toBe("the whole journal");
    await expect(openBackup(sealed, other.privateKey)).rejects.toThrow("wrong key");
    const tampered = sealed.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(openBackup(tampered, keys.privateKey)).rejects.toThrow("damaged");
  });

  it("won't take a private key as the public one", async () => {
    const keys = await newBackupKeys();
    const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
    await expect(importPublicKey(JSON.stringify(privateJwk))).rejects.toThrow("public key only");
  });
});

describe("backup names", () => {
  it("names each by when it was taken, and finds those over 30 days old", () => {
    const now = Date.UTC(2026, 9, 17, 3, 17, 0);
    expect(backupKey(now)).toBe("notonawa-daily-20261017T031700Z.json.gz.enc");
    const keys = [
      backupKey(now - 31 * 86400000), backupKey(now - 29 * 86400000), backupKey(now), "something-else.txt",
    ];
    expect(expiredBackupKeys(keys, now)).toEqual([keys[0]]);
  });
});

describe("backupToSql", () => {
  it("makes the tables, their rows, then indexes and triggers", () => {
    const sql = backupToSql({
      format: "notonawa-backup",
      schema: [
        { type: "table", name: "people", sql: "CREATE TABLE people (id TEXT, name TEXT, n INTEGER)" },
        { type: "index", name: "idx", sql: "CREATE INDEX idx ON people(name)" },
        { type: "table", name: "empty", sql: "CREATE TABLE empty (x)" },
      ],
      tables: { people: [{ id: "p1", name: "O'Neil", n: 3 }, { id: "p2", name: null, n: 1.5 }], empty: [] },
    });
    expect(sql.split("\n")).toEqual([
      "PRAGMA defer_foreign_keys = true;",
      "CREATE TABLE people (id TEXT, name TEXT, n INTEGER);",
      `INSERT INTO "people" ("id", "name", "n") VALUES ('p1', 'O''Neil', 3);`,
      `INSERT INTO "people" ("id", "name", "n") VALUES ('p2', NULL, 1.5);`,
      "CREATE TABLE empty (x);",
      "CREATE INDEX idx ON people(name);",
      "",
    ]);
  });

  it("refuses anything else", () => {
    expect(() => backupToSql({ format: "other", schema: [], tables: {} })).toThrow();
  });
});
