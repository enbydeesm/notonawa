import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { create, signedInUser } from "../helpers.js";
import { takeBackup } from "../../src/backup/run.js";
import { newBackupKeys, openBackup } from "../../src/backup/crypto.js";
import { backupKey } from "../../src/backup/names.js";

const DAY = 24 * 60 * 60 * 1000;
// Optional in Env (the dev environment has none), but always there in tests.
const BACKUPS = /** @type {R2Bucket} */ (env.BACKUPS);

/** @param {Uint8Array} gz */
async function gunzipJson(gz) {
  return JSON.parse(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
}

describe("the daily backup", () => {
  // The bucket is shared between tests: start each one empty, so one test's
  // backup isn't counted (or deleted) by another.
  beforeEach(async () => {
    const keys = (await BACKUPS.list()).objects.map((o) => o.key);
    if (keys.length) await BACKUPS.delete(keys);
  });

  it("saves the whole database, sealed so only the private key opens it", async () => {
    const me = await signedInUser();
    await create("/api/people", { name: "Backed up" });
    const keys = await newBackupKeys();
    const publicJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", keys.publicKey));
    const now = Date.UTC(2026, 9, 17, 3, 17, 0);

    const { saved } = await takeBackup(env.DB, BACKUPS, publicJwk, now);
    expect(saved).toBe(backupKey(now));
    const object = await BACKUPS.get(saved);
    const sealed = new Uint8Array(await /** @type {R2ObjectBody} */ (object).arrayBuffer());
    // Not readable as it's stored.
    expect(new TextDecoder().decode(sealed)).not.toContain("Backed up");

    const doc = await gunzipJson(await openBackup(sealed, keys.privateKey));
    expect(doc).toMatchObject({ format: "notonawa-backup", version: 1, taken_at: "2026-10-17T03:17:00.000Z" });
    expect(doc.tables.users.map((/** @type {any} */ u) => u.id)).toContain(me.id);
    expect(doc.tables.people.map((/** @type {any} */ p) => p.name)).toContain("Backed up");
    expect(Object.keys(doc.tables)).toEqual(expect.arrayContaining(["ties", "media", "notices", "d1_migrations"]));
    expect(doc.schema.some((/** @type {any} */ s) => s.type === "trigger")).toBe(true);
  });

  it("deletes backups over 30 days old, and nothing else", async () => {
    const keys = await newBackupKeys();
    const publicJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", keys.publicKey));
    const now = Date.UTC(2026, 11, 1, 3, 17, 0);
    const old = backupKey(now - 31 * DAY);
    const recent = backupKey(now - 29 * DAY);
    for (const key of [old, recent, "notes.txt"]) await BACKUPS.put(key, "x");

    const { deleted } = await takeBackup(env.DB, BACKUPS, publicJwk, now);
    expect(deleted).toBe(1);
    expect(await BACKUPS.head(old)).toBeNull();
    expect(await BACKUPS.head(recent)).not.toBeNull();
    expect(await BACKUPS.head("notes.txt")).not.toBeNull();
  });
});
