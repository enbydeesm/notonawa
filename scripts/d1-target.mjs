// Which database the scripts' wrangler commands go to, from their
// command-line flags. Pure, so it's unit tested (d1.mjs, which runs
// wrangler, can't be loaded in the tests' Workers runtime).

/**
 * The target from command-line flags: the local database by default (or a
 * throwaway copy with --persist-to <dir>), the real one with --remote, or the
 * dev environment's (wrangler.jsonc's env.dev, dev.notonawa.app) with --dev.
 * The commands name the database by its binding, DB, so the same name works
 * for every target.
 * @param {string[]} args
 * @returns {string[]}
 */
export function targetFlags(args) {
  if (args.includes("--dev")) {
    // Either could be a slip for the other, so refuse rather than guess.
    if (args.includes("--remote")) throw new Error("Use --dev or --remote, not both.");
    if (args.includes("--persist-to")) throw new Error("Use --dev or --persist-to, not both.");
    return ["--remote", "--env", "dev"];
  }
  if (args.includes("--remote")) return ["--remote"];
  const at = args.indexOf("--persist-to");
  return at === -1 ? ["--local"] : ["--local", "--persist-to", args[at + 1]];
}

/**
 * A short word for the target, for file names and messages.
 * @param {string[]} flags from targetFlags
 * @returns {"dev" | "remote" | "local"}
 */
export function targetName(flags) {
  if (flags.includes("--env")) return "dev";
  return flags.includes("--remote") ? "remote" : "local";
}
