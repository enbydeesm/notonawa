// Run once after the release's deploy (phase 7 of encrypting everything):
//
// 1. Makes accounts with nothing in their journal format 2 straight away,
//    so they never see the conversion (release-cleanup-lib.mjs says what
//    counts as empty).
// 2. Deletes format 1's connections between accounts, and the offers to
//    make one. Format 2 keeps none on the server (contacts are in each
//    journal, sealed), and the privacy policy says the server keeps no
//    record of who is connected; an old connection can't become a contact
//    (it has no keys), so people connect again. Their cards stay, unlinked
//    (people.connection_id's foreign key clears it). Old invites marked to
//    connect stop offering it.
//
//   node scripts/release-cleanup.mjs --dry-run [--remote | --dev]   what it would do
//   node scripts/release-cleanup.mjs [--remote | --dev]             do it

import { d1, targetFlags } from "./d1.mjs";
import {
  COUNT_SQL, MARK_SQL, DELETE_ME_SQL, CONNECTIONS_COUNT_SQL, STOP_INVITE_OFFERS_SQL, DELETE_OFFERS_SQL, DELETE_CONNECTIONS_SQL,
} from "./release-cleanup-lib.mjs";

const args = process.argv.slice(2);
const flags = targetFlags(args);

if (args.includes("--dry-run")) {
  const empty = d1(COUNT_SQL, flags).results[0]?.n ?? 0;
  const { connections, offers } = d1(CONNECTIONS_COUNT_SQL, flags).results[0] ?? {};
  console.log(`${empty} empty format 1 account(s) would be made format 2.`);
  console.log(`${connections ?? 0} connection row(s) (two per connection) and ${offers ?? 0} offer(s) to connect would be deleted.`);
} else {
  const { results } = d1(MARK_SQL, flags);
  d1(DELETE_ME_SQL, flags);
  console.log(`Made ${results.length} empty account(s) format 2. Each makes its sealed "Me" at its next unlock.`);
  d1(STOP_INVITE_OFFERS_SQL, flags);
  d1(DELETE_OFFERS_SQL, flags);
  d1(DELETE_CONNECTIONS_SQL, flags);
  console.log("Deleted format 1's connections and offers to connect.");
}
