// Decrypts a backup back into SQL.
//
//   node scripts/restore-backup.mjs backups/notonawa-remote-20261013T174200Z.sql.enc
//     a backup from scripts/backup.mjs (asks for its passphrase): -remote-,
//     -dev- (the dev environment's) or -local- in its name
//   node scripts/restore-backup.mjs backups/notonawa-daily-20261017T031700Z.json.gz.enc [--key <file>]
//     one of the Worker's daily backups (asks for the private key's
//     passphrase; the key is backups/backup-private-key.enc unless --key
//     says otherwise). Download one first, by its name (the Cloudflare
//     dashboard lists them, under R2 > notonawa-backups; the dev
//     environment takes none):
//       npx wrangler r2 object get notonawa-backups/<name> --file backups/<name> --remote
//
// Writes the .sql next to it (without .enc, or .json.gz.enc), readable only
// by you. It doesn't load it anywhere: to look at it, load it into a
// throwaway local database,
//   npx wrangler d1 execute DB --local --persist-to <new folder> --file <the .sql>
// and delete the .sql when you're done (it's unencrypted journal data).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { decryptBackup, backupToSql } from "./backup-lib.mjs";
import { openBackup, RSA } from "../src/backup/crypto.js";
import { askHidden } from "./ask.mjs";

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--key");
try {
  let out;
  let sql;
  if (file?.endsWith(".sql.enc")) {
    out = file.slice(0, -".enc".length);
    if (existsSync(out)) throw new Error(`${out} already exists. Delete it first.`);
    const secret = process.env.BACKUP_PASSPHRASE || await askHidden("Backup passphrase: ");
    sql = await decryptBackup(readFileSync(file), secret);
  } else if (file?.endsWith(".json.gz.enc")) {
    out = file.slice(0, -".json.gz.enc".length) + ".sql";
    if (existsSync(out)) throw new Error(`${out} already exists. Delete it first.`);
    const keyAt = args.indexOf("--key");
    const keyFile = keyAt === -1 ? path.join(import.meta.dirname, "..", "backups", "backup-private-key.enc") : args[keyAt + 1];
    const secret = process.env.BACKUP_PASSPHRASE || await askHidden("Private key passphrase: ");
    const jwk = JSON.parse(new TextDecoder().decode(await decryptBackup(readFileSync(keyFile), secret)));
    const privateKey = await crypto.subtle.importKey("jwk", jwk, RSA, false, ["decrypt"]);
    const json = gunzipSync(await openBackup(readFileSync(file), privateKey)).toString("utf8");
    sql = new TextEncoder().encode(backupToSql(JSON.parse(json)));
  } else {
    throw new Error("Give the backup file to open (.sql.enc or .json.gz.enc).");
  }
  writeFileSync(out, sql, { mode: 0o600, flag: "wx" });
  console.log(`Wrote ${out}. It's unencrypted: delete it when you're done.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
