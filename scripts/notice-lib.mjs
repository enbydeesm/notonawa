// Reading scripts/notice.mjs's command line, and quoting for its SQL. Pure,
// so it's easy to test.

const ID = /^[0-9a-f-]{36}$/;
const DATE = /^(\d{4})-(\d\d)-(\d\d)$/;
export const MAX_MESSAGE = 1000;

/**
 * A text value for SQL: quoted, with any quote doubled (all SQLite needs).
 * @param {string} text
 */
export function sqlText(text) {
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * Midnight at the start of a day on this computer's calendar, as an ISO time.
 * @param {string} date YYYY-MM-DD
 * @param {number} [plusDays]
 */
export function startOfDay(date, plusDays = 0) {
  const m = date.match(DATE);
  if (!m) throw new Error(`Dates are written like 2026-11-01, not "${date}".`);
  return new Date(+m[1], +m[2] - 1, +m[3] + plusDays).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * What to do, from the arguments (target flags aside).
 * @param {string[]} args
 * @returns {{ action: "list" } | { action: "end", id: string } | { action: "add", notice: {
 *   message: string, level: "info" | "warning", link: "privacy" | null, userId: string | null,
 *   startsAt: string | null, endsAt: string | null } }}
 */
export function readNoticeArgs(args) {
  /** @param {string} flag */
  const value = (flag) => {
    const at = args.indexOf(flag);
    if (at === -1) return null;
    const v = args[at + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value.`);
    return v;
  };
  if (args.includes("--list")) return { action: "list" };
  const end = value("--end");
  if (end !== null) {
    if (!ID.test(end)) throw new Error("--end needs a notice's id (see --list).");
    return { action: "end", id: end };
  }
  const withValue = ["--from", "--until", "--user", "--link", "--persist-to"];
  const words = args.filter((a, i) => !a.startsWith("--") && !withValue.includes(args[i - 1]));
  if (words.length !== 1) throw new Error('Give the message as one argument, in quotes: node scripts/notice.mjs "…"');
  const message = words[0].trim();
  if (!message || message.length > MAX_MESSAGE) throw new Error(`A message is 1 to ${MAX_MESSAGE} characters.`);
  const userId = value("--user");
  if (userId !== null && !ID.test(userId)) throw new Error("--user needs an account's id (node scripts/recovery-code.mjs lists them).");
  const link = value("--link");
  if (link !== null && link !== "privacy") throw new Error("--link can only be privacy, for now.");
  const from = value("--from");
  const until = value("--until");
  const startsAt = from === null ? null : startOfDay(from);
  // --until is the last day it shows: it ends as the next day starts.
  const endsAt = until === null ? null : startOfDay(until, 1);
  if (endsAt !== null && endsAt <= (startsAt ?? new Date().toISOString())) throw new Error("--until has to be after it starts.");
  return {
    action: "add",
    notice: { message, level: args.includes("--warning") ? "warning" : "info", link, userId, startsAt, endsAt },
  };
}
