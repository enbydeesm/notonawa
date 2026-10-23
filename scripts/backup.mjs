// Takes an encrypted backup of the notonawa database on this computer, and
// deletes backups older than RETENTION_DAYS (30, as PRIVACY.md says). The
// Worker also takes one every day by itself (src/backup/); this is for an
// extra copy away from Cloudflare.
//
//   node scripts/backup.mjs --remote          back up the real database
//   node scripts/backup.mjs --dev             back up the dev environment's
//   node scripts/backup.mjs [--local]         back up the local one
//   node scripts/backup.mjs --prune-only      just delete old backups
//
// The passphrase comes from BACKUP_PASSPHRASE, or is asked for (twice). Keep
// it somewhere safe, like a password manager: without it a backup can't be
// opened. The unencrypted export only ever exists in a private temporary
// folder, deleted straight after. Backups go in backups/ (git-ignored).
//
// Old backups are only deleted when this runs, so run it at least monthly.
// Open one with scripts/restore-backup.mjs.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { targetFlags, targetName } from "./d1-target.mjs";
import { encryptBackup, backupName, expiredBackups, RETENTION_DAYS, MIN_PASSPHRASE } from "./backup-lib.mjs";
import { askHidden } from "./ask.mjs";

const BACKUPS = path.join(import.meta.dirname, "..", "backups");
const args = process.argv.slice(2);

function prune() {
  const old = expiredBackups(readdirSync(BACKUPS), Date.now());
  for (const name of old) rmSync(path.join(BACKUPS, name));
  console.log(old.length
    ? `Deleted ${old.length} backup(s) older than ${RETENTION_DAYS} days.`
    : `No backups older than ${RETENTION_DAYS} days.`);
}

async function passphrase() {
  if (process.env.BACKUP_PASSPHRASE) return process.env.BACKUP_PASSPHRASE;
  const first = await askHidden("Backup passphrase: ");
  if (first.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  if ((await askHidden("Again, to check: ")) !== first) throw new Error("The passphrases don't match.");
  return first;
}

try {
  mkdirSync(BACKUPS, { recursive: true });
  if (!args.includes("--prune-only")) {
    const flags = targetFlags(args);
    const secret = await passphrase();
    // mkdtemp makes the folder readable only by you.
    const work = mkdtempSync(path.join(tmpdir(), "notonawa-backup-"));
    try {
      const dump = path.join(work, "dump.sql");
      const run = spawnSync("npx", ["wrangler", "d1", "export", "DB", ...flags, "--output", dump], { encoding: "utf8" });
      if (run.status !== 0) throw new Error(`wrangler d1 export failed:\n${run.stdout}${run.stderr}`);
      const file = path.join(BACKUPS, backupName(targetName(flags), Date.now()));
      writeFileSync(file, await encryptBackup(readFileSync(dump), secret), { mode: 0o600 });
      console.log(`Saved ${path.relative(process.cwd(), file)}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  prune();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
