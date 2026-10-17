// The daily backup (cron trigger, wrangler.jsonc): the whole database read in
// one batch, as JSON, gzipped, sealed with the backup public key
// (backup/crypto.js) and saved in the private BACKUPS bucket. Backups older
// than BACKUP_DAYS are deleted. Photos aren't backed up: they're already
// encrypted on people's devices, and once deleted they should stay gone.
//
// Open one with scripts/restore-backup.mjs (it needs the backup private key).

import { importPublicKey, sealBackup } from "./crypto.js";
import { backupKey, expiredBackupKeys } from "./names.js";

export const BACKUP_FORMAT = "notonawa-backup";

/**
 * Everything in the database: the schema (tables, then indexes and
 * triggers) and every table's rows.
 * @param {D1Database} db
 * @param {number} now
 */
export async function dumpDatabase(db, now) {
  const { results: schema } = await db.prepare(
    `SELECT type, name, sql FROM sqlite_master
      WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid`
  ).all();
  // Names straight from sqlite_master, quoted; never from a request.
  const tables = schema.filter((s) => s.type === "table").map((s) => /** @type {string} */ (s.name));
  const rows = tables.length ? await db.batch(tables.map((t) => db.prepare(`SELECT * FROM "${t.replace(/"/g, '""')}"`))) : [];
  return {
    format: BACKUP_FORMAT,
    version: 1,
    taken_at: new Date(now).toISOString(),
    schema,
    tables: Object.fromEntries(tables.map((t, i) => [t, rows[i].results])),
  };
}

/**
 * @param {D1Database} db
 * @param {R2Bucket} bucket
 * @param {string} publicKeyJwk BACKUP_PUBLIC_KEY
 * @param {number} [now]
 * @returns {Promise<{ saved: string, deleted: number }>}
 */
export async function takeBackup(db, bucket, publicKeyJwk, now = Date.now()) {
  const publicKey = await importPublicKey(publicKeyJwk);
  const json = JSON.stringify(await dumpDatabase(db, now));
  const gzipped = new Uint8Array(await new Response(
    new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))
  ).arrayBuffer());
  const saved = backupKey(now);
  await bucket.put(saved, await sealBackup(gzipped, publicKey));

  let deleted = 0;
  /** @type {string | undefined} */
  let cursor;
  do {
    const listed = await bucket.list({ prefix: "notonawa-daily-", cursor });
    const old = expiredBackupKeys(listed.objects.map((o) => o.key), now);
    if (old.length) await bucket.delete(old);
    deleted += old.length;
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return { saved, deleted };
}
