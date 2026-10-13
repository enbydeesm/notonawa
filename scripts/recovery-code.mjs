// Gives an account a new recovery code, replacing its old one. Use it to move
// an account that has no passkey yet (like the one from before passkeys) or
// to help someone locked out who asks you to. Prints the code; only a hash of
// the login secret derived from it is stored, as when the app makes one.
//
// Once encryption arrives (step 4 in considerations.md), this restores
// signing in only: encrypted notes and photos still need the person's own
// passkey or their own earlier recovery code.
//
//   node scripts/recovery-code.mjs [--remote]             list accounts
//   node scripts/recovery-code.mjs <user-id> [--remote]   set a new code

import { d1, targetFlags } from "./d1.mjs";
import { newRecoveryCode, readRecoveryCode, loginSecret } from "../public/js/recovery.js";
import { sha256Hex } from "../src/auth/session.js";

const args = process.argv.slice(2);
const flags = targetFlags(args);
const userId = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--persist-to");

if (!userId) {
  const { results } = d1(
    `SELECT u.id, u.created_at, (SELECT count(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys
     FROM users u ORDER BY u.created_at`, flags);
  console.table(results);
  console.log("Run again with a user id to give that account a new recovery code.");
  process.exit(0);
}

if (!/^[\w-]+$/.test(userId)) {
  console.error("That doesn't look like a user id.");
  process.exit(1);
}

const code = newRecoveryCode();
const hash = await sha256Hex(await loginSecret(/** @type {string} */ (readRecoveryCode(code))));
// RETURNING, because local wrangler doesn't report how many rows changed.
const { results } = d1(`UPDATE users SET recovery_secret_hash = '${hash}' WHERE id = '${userId}' RETURNING id`, flags);
if (results.length === 0) {
  console.error(`No account with id ${userId}.`);
  process.exit(1);
}

if (args.includes("--quiet")) console.log(code);
else console.log(`New recovery code: ${code}\nSign in with "Use a recovery code", then add a passkey.`);
