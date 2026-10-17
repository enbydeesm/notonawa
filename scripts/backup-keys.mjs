// Makes the key pair for the Worker's daily backups (src/backup/). Run it
// once, on your own computer:
//
//   node scripts/backup-keys.mjs
//
// It prints the public key: put it in wrangler.jsonc as BACKUP_PUBLIC_KEY
// and deploy. The Worker can lock backups with it, but not open them.
// The private key is saved in backups/backup-private-key.enc, encrypted with
// a passphrase you choose. Keep that file and its passphrase somewhere safe
// and apart (e.g. the file in your password manager, as an attachment):
// without both, no backup can be opened. Making a new pair later is fine:
// keep the old private key until the backups it opens are gone (30 days).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { newBackupKeys } from "../src/backup/crypto.js";
import { encryptBackup, MIN_PASSPHRASE } from "./backup-lib.mjs";
import { askHidden } from "./ask.mjs";

const BACKUPS = path.join(import.meta.dirname, "..", "backups");
const file = path.join(BACKUPS, "backup-private-key.enc");

try {
  if (existsSync(file)) throw new Error(`${file} already exists. Move it somewhere safe first, then run this again.`);
  const passphrase = process.env.BACKUP_PASSPHRASE || await askHidden("Passphrase for the private key: ");
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  if (!process.env.BACKUP_PASSPHRASE && (await askHidden("Again, to check: ")) !== passphrase) throw new Error("The passphrases don't match.");
  const keys = await newBackupKeys();
  const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  mkdirSync(BACKUPS, { recursive: true });
  writeFileSync(file, await encryptBackup(new TextEncoder().encode(JSON.stringify(privateJwk)), passphrase), { mode: 0o600, flag: "wx" });
  const { kty, n, e } = publicJwk;
  console.log(`Saved the private key, encrypted, in ${path.relative(process.cwd(), file)}. Keep it and its passphrase safe.\n`);
  console.log("Put this in wrangler.jsonc as BACKUP_PUBLIC_KEY (one line):\n");
  console.log(JSON.stringify(JSON.stringify({ kty, n, e, alg: "RSA-OAEP-256", ext: true, key_ops: ["encrypt"] })));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
