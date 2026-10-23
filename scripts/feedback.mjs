// Lists the bug reports and ideas sent from the app's "Bug and feedback"
// form, newest first. To answer one, post a notice to its account:
// node scripts/notice.mjs "…" --user <account id>.
//
//   node scripts/feedback.mjs [--remote | --dev]      the last 50
//     --since 2026-10-20                              only those sent since that day
//     --kind bug | idea                               only bugs, or only ideas

import { d1, targetFlags } from "./d1.mjs";

const args = process.argv.slice(2);
const flags = targetFlags(args);

/** @param {string} name */
const value = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1] ?? "";
};

try {
  const since = value("--since");
  const kind = value("--kind");
  // Checked against fixed patterns, so they're safe to put in the SQL.
  if (since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("Write --since as YYYY-MM-DD.");
  if (kind !== null && !["bug", "idea"].includes(kind)) throw new Error("--kind is bug or idea.");
  const where = [since ? `created_at >= '${since}'` : null, kind ? `kind = '${kind}'` : null].filter(Boolean);
  const { results } = d1(
    `SELECT id, user_id, kind, app_version, created_at, message FROM feedback
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC LIMIT 50`, flags);
  if (results.length === 0) console.log("No feedback.");
  for (const f of results) {
    console.log(`${f.created_at}  ${f.kind}  from ${f.user_id}  (version ${f.app_version})\n  ${String(f.message).replace(/\n/g, "\n  ")}\n`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
