// Makes an invite code for a new account. Prints the code; only its hash is
// stored. Each code works once, within 14 days (or --days N).
//
//   node scripts/invite.mjs            local database
//   node scripts/invite.mjs --remote   the real one
//   node scripts/invite.mjs --dev      the dev environment's (dev.notonawa.app)
//
// Send the code to the person privately. Anyone who has it can sign up.

import { d1, targetFlags } from "./d1.mjs";
import { newCode, normaliseCode } from "../public/js/codes.js";
import { sha256Hex, isoAt } from "../src/auth/session.js";

const args = process.argv.slice(2);
const daysAt = args.indexOf("--days");
const days = daysAt === -1 ? 14 : Number(args[daysAt + 1]);
if (!Number.isInteger(days) || days < 1) {
  console.error("--days should be a whole number, 1 or more.");
  process.exit(1);
}

const code = newCode(10);
const hash = await sha256Hex(/** @type {string} */ (normaliseCode(code)));
const expires = isoAt(Date.now() + days * 24 * 60 * 60 * 1000);
d1(`INSERT INTO invites (code_hash, expires_at) VALUES ('${hash}', '${expires}')`, targetFlags(args));

if (args.includes("--quiet")) console.log(code);
else console.log(`Invite code: ${code}\nWorks once, until ${expires}.`);
