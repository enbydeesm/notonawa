import { describe, it, expect } from "vitest";
import { encryptBackup, decryptBackup, backupName, expiredBackups } from "../../scripts/backup-lib.mjs";

// The Workers runtime caps PBKDF2 at 100,000 iterations; the real backups use
// more, and the count is read back from each file.
const FAST = 1000;
const text = (/** @type {string} */ s) => new TextEncoder().encode(s);

describe("encrypted backups", () => {
  it("round-trips with the right passphrase", async () => {
    const file = await encryptBackup(text("INSERT INTO ties ..."), "correct horse battery", FAST);
    expect(new TextDecoder().decode(await decryptBackup(file, "correct horse battery"))).toBe("INSERT INTO ties ...");
  });

  it("reads a file that's a view into a bigger buffer, as Node's file Buffers are", async () => {
    const file = await encryptBackup(text("pooled"), "correct horse battery", FAST);
    const pool = new Uint8Array(file.length + 100).fill(0xff);
    pool.set(file, 37);
    const view = pool.subarray(37, 37 + file.length);
    expect(new TextDecoder().decode(await decryptBackup(view, "correct horse battery"))).toBe("pooled");
  });

  it("refuses a damaged iteration count instead of hanging", async () => {
    const file = await encryptBackup(text("x"), "correct horse battery", FAST);
    file.set([0xff, 0xff, 0xff, 0xff], 4);
    await expect(decryptBackup(file, "correct horse battery")).rejects.toThrow("damaged");
  });

  it("doesn't contain the plaintext, and differs every time", async () => {
    const a = await encryptBackup(text("secret notes"), "correct horse battery", FAST);
    const b = await encryptBackup(text("secret notes"), "correct horse battery", FAST);
    expect(new TextDecoder("latin1").decode(a)).not.toContain("secret notes");
    expect(a).not.toEqual(b);
  });

  it("refuses the wrong passphrase, a changed file, and other files", async () => {
    const file = await encryptBackup(text("x"), "correct horse battery", FAST);
    await expect(decryptBackup(file, "wrong passphrase!!")).rejects.toThrow("wrong passphrase");
    const tampered = file.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(decryptBackup(tampered, "correct horse battery")).rejects.toThrow("damaged");
    const header = file.slice();
    header[10] ^= 1; // in the salt: authenticated, so it's caught
    await expect(decryptBackup(header, "correct horse battery")).rejects.toThrow();
    await expect(decryptBackup(text("-- plain SQL dump, long enough to pass the size check......"), "x")).rejects.toThrow("isn't a NotoNawa backup");
  });
});

describe("backup names and retention", () => {
  const now = Date.UTC(2026, 9, 13, 12, 0, 0);

  it("names a backup by where it's from and when", () => {
    expect(backupName("remote", now)).toBe("notonawa-remote-20261013T120000Z.sql.enc");
  });

  it("picks out backups older than 7 days, and nothing else", () => {
    expect(expiredBackups([
      "notonawa-remote-20261006T115959Z.sql.enc", // 7 days and a second: expired
      "notonawa-remote-20261006T120000Z.sql.enc", // exactly 7 days: kept
      "notonawa-local-20261001T000000Z.sql.enc",
      "notonawa-remote-20261013T110000Z.sql.enc",
      "rope-journal-remote-20261005T000000Z.sql.enc", // from before the rename: still expires
      "rope-journal-remote-20261012T000000Z.sql.enc",
      "notes.sql", "notonawa-remote-20201006T115959Z.sql", ".DS_Store",
    ], now)).toEqual([
      "notonawa-remote-20261006T115959Z.sql.enc",
      "notonawa-local-20261001T000000Z.sql.enc",
      "rope-journal-remote-20261005T000000Z.sql.enc",
    ]);
  });
});
