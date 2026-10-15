// Decrypts a backup made by scripts/backup.mjs back into SQL.
//
//   node scripts/restore-backup.mjs backups/notonawa-remote-20261013T174200Z.sql.enc
//
// Writes the .sql next to it (without .enc), readable only by you. It doesn't
// load it anywhere: to look at it, load it into a throwaway local database,
//   npx wrangler d1 execute notonawa --local --persist-to <new folder> --file <the .sql>
// and delete the .sql when you're done (it's unencrypted journal data).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { decryptBackup } from "./backup-lib.mjs";
import { askHidden } from "./ask.mjs";

const file = process.argv[2];
try {
  if (!file?.endsWith(".sql.enc")) throw new Error("Give the .sql.enc backup file to open.");
  const out = file.slice(0, -".enc".length);
  if (existsSync(out)) throw new Error(`${out} already exists. Delete it first.`);
  const secret = process.env.BACKUP_PASSPHRASE || await askHidden("Backup passphrase: ");
  writeFileSync(out, await decryptBackup(readFileSync(file), secret), { mode: 0o600, flag: "wx" });
  console.log(`Wrote ${out}. It's unencrypted: delete it when you're done.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
