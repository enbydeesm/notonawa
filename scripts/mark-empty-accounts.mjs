// Makes accounts with nothing in their journal format 2 straight away, so
// they never see the conversion (run once after the release's deploy,
// phase 7 of encrypting everything). See mark-empty-lib.mjs for what
// counts as empty.
//
//   node scripts/mark-empty-accounts.mjs --dry-run [--remote | --dev]   how many there are
//   node scripts/mark-empty-accounts.mjs [--remote | --dev]             mark them

import { d1, targetFlags } from "./d1.mjs";
import { COUNT_SQL, MARK_SQL, DELETE_ME_SQL } from "./mark-empty-lib.mjs";

const args = process.argv.slice(2);
const flags = targetFlags(args);

if (args.includes("--dry-run")) {
  const { results } = d1(COUNT_SQL, flags);
  console.log(`${results[0]?.n ?? 0} empty format 1 account(s) would be made format 2.`);
} else {
  const { results } = d1(MARK_SQL, flags);
  d1(DELETE_ME_SQL, flags);
  console.log(`Made ${results.length} empty account(s) format 2. Each makes its sealed "Me" at its next unlock.`);
}
