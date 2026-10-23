// Posts a message (a notice) that shows as a banner in the app, to everyone
// or to one account, until it's dismissed or ends. Use it to tell people
// about a change to the privacy policy before it takes effect, a problem
// with the service, or (to one person) a legal request for their data.
// Messages are plain text: no formatting or links, apart from --link.
//
//   node scripts/notice.mjs "Message" [--remote]   post it to everyone, from now on
//     --warning               show it as a warning (a red edge) rather than news
//     --user <account id>     just for that account (ids: node scripts/recovery-code.mjs)
//     --link privacy          add a "Read the privacy policy" link
//     --from 2026-11-01       start showing it that day (this computer's calendar)
//     --until 2026-11-30      stop showing it after that day
//   node scripts/notice.mjs --list [--remote]       notices showing now or later
//   node scripts/notice.mjs --end <id> [--remote]   stop showing one now
// (--dev in place of --remote: the dev environment's.)

import { d1, targetFlags } from "./d1.mjs";
import { readNoticeArgs, sqlText } from "./notice-lib.mjs";

const args = process.argv.slice(2);
const flags = targetFlags(args);
const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

try {
  const todo = readNoticeArgs(args);
  if (todo.action === "list") {
    const { results } = d1(
      `SELECT id, user_id, level, link, starts_at, ends_at, message FROM notices
        WHERE ends_at IS NULL OR ends_at > ${NOW} ORDER BY starts_at`, flags);
    if (results.length === 0) console.log("No notices showing now or later.");
    for (const n of results) {
      console.log(`${n.id}  ${n.user_id ? `for ${n.user_id}` : "for everyone"}, ${n.level}` +
        `${n.link ? `, link: ${n.link}` : ""}, from ${n.starts_at}${n.ends_at ? ` until ${n.ends_at}` : ""}\n  ${n.message}`);
    }
  } else if (todo.action === "end") {
    d1(`UPDATE notices SET ends_at = ${NOW} WHERE id = '${todo.id}' AND (ends_at IS NULL OR ends_at > ${NOW})`, flags);
    console.log("Ended (if it was showing).");
  } else {
    const n = todo.notice;
    const id = crypto.randomUUID();
    if (n.userId) {
      const { results } = d1(`SELECT id FROM users WHERE id = '${n.userId}'`, flags);
      if (results.length === 0) throw new Error("There's no account with that id.");
    }
    d1(`INSERT INTO notices (id, user_id, message, level, link, starts_at, ends_at) VALUES (
      '${id}', ${n.userId ? `'${n.userId}'` : "NULL"}, ${sqlText(n.message)}, '${n.level}',
      ${n.link ? `'${n.link}'` : "NULL"}, ${n.startsAt ? `'${n.startsAt}'` : NOW}, ${n.endsAt ? `'${n.endsAt}'` : "NULL"})`, flags);
    console.log(`Posted notice ${id}${n.userId ? " for that account" : " for everyone"}.`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
