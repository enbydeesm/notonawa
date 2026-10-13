// Runs SQL against the rope-journal database with wrangler, for the scripts
// in this folder. Local by default; --remote for the real one, or
// --persist-to <dir> for a throwaway local copy (the UI smoke test uses this).

import { spawnSync } from "node:child_process";

/**
 * The target from command-line flags.
 * @param {string[]} args
 */
export function targetFlags(args) {
  if (args.includes("--remote")) return ["--remote"];
  const at = args.indexOf("--persist-to");
  return at === -1 ? ["--local"] : ["--local", "--persist-to", args[at + 1]];
}

/**
 * Runs one SQL command and returns its rows. Values must already be safe to
 * put in SQL (the scripts only use hex, ids checked against a pattern, and
 * timestamps they made).
 * @param {string} sql
 * @param {string[]} flags from targetFlags
 * @returns {{ results: Record<string, unknown>[] }}
 */
export function d1(sql, flags) {
  const run = spawnSync("npx", ["wrangler", "d1", "execute", "rope-journal", ...flags, "--json", "--command", sql], { encoding: "utf8" });
  if (run.status !== 0) {
    console.error(run.stdout, run.stderr);
    process.exit(1);
  }
  return JSON.parse(run.stdout)[0];
}
