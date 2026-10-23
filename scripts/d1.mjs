// Runs SQL against the notonawa database with wrangler, for the scripts
// in this folder. Local by default; --remote for the real one, --dev for the
// dev environment's, or --persist-to <dir> for a throwaway local copy (the UI
// smoke test uses this). See d1-target.mjs.

import { spawnSync } from "node:child_process";
import { targetFlags as readTarget } from "./d1-target.mjs";

/**
 * The target from command-line flags (d1-target.mjs), stopping the script
 * with the reason if they clash.
 * @param {string[]} args
 */
export function targetFlags(args) {
  try {
    return readTarget(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
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
  const run = spawnSync("npx", ["wrangler", "d1", "execute", "DB", ...flags, "--json", "--command", sql], { encoding: "utf8" });
  if (run.status !== 0) {
    console.error(run.stdout, run.stderr);
    process.exit(1);
  }
  return JSON.parse(run.stdout)[0];
}
