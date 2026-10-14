// Gives an account a new recovery code, replacing its old one. Use it to move
// an account that has no passkey yet (like the one from before passkeys) or
// to help someone locked out who asks you to. Prints the code; only a hash of
// the login secret derived from it is stored, as when the app makes one.
//
// Only help someone who set a recovery email, and only once they've shown the
// address is theirs: find their account with --email, then email a one-time
// code to that address from your own mailbox and ask them to send it back. A
// message that merely comes "from" the address proves nothing; those can be
// faked. Without a recovery email there's no way to tell the account is theirs.
//
// Once encryption arrives (step 4 in considerations.md), this restores
// signing in only: encrypted notes and photos still need the person's own
// passkey or their own earlier recovery code.
//
//   node scripts/recovery-code.mjs [--remote]                    list accounts
//   node scripts/recovery-code.mjs --email <address> [--remote]  find the account with that recovery email
//   node scripts/recovery-code.mjs <user-id> [--remote]          set a new code

import { d1, targetFlags } from "./d1.mjs";
import { newRecoveryCode, readRecoveryCode, loginSecret } from "../public/js/recovery.js";
import { readRecoveryEmail, hashRecoveryEmail } from "../public/js/recovery-email.js";
import { sha256Hex } from "../src/auth/session.js";

const args = process.argv.slice(2);
const flags = targetFlags(args);
const emailAt = args.indexOf("--email");
const userId = args.find((a, i) => !a.startsWith("--") && !["--persist-to", "--email"].includes(args[i - 1]));

if (emailAt !== -1) {
  const email = readRecoveryEmail(args[emailAt + 1]);
  if (!email) {
    console.error("That doesn't look like an email address.");
    process.exit(1);
  }
  // Each account's hash has its own salt, so every one has to be checked.
  // About a third of a second each.
  const { results } = d1(
    `SELECT id, created_at, recovery_email_hash, recovery_email_salt FROM users
     WHERE recovery_email_hash IS NOT NULL ORDER BY created_at`, flags);
  const matches = [];
  for (const user of results) {
    if (await hashRecoveryEmail(email, String(user.recovery_email_salt)) === user.recovery_email_hash) {
      matches.push({ id: user.id, created_at: user.created_at });
    }
  }
  if (matches.length === 0) {
    console.log(`No account has ${email} as its recovery email (checked ${results.length}).`);
    process.exit(0);
  }
  console.table(matches);
  console.log("Before giving it a new recovery code, check the address is theirs: email a one-time code to it\n" +
    "from your own mailbox and ask them to send it back. Then run again with the user id.");
  process.exit(0);
}

if (!userId) {
  const { results } = d1(
    `SELECT u.id, u.created_at, (SELECT count(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys,
            u.recovery_email_hash IS NOT NULL AS recovery_email
     FROM users u ORDER BY u.created_at`, flags);
  console.table(results);
  console.log("Run again with a user id to give that account a new recovery code, or with --email <address>\n" +
    "to find the account with that recovery email.");
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
