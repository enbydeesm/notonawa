// The checks a change needs, rather than all of them: lint, type check and
// every Vitest test (quick enough to always run all of them), then only the
// generated-file checks and (with --ui) walkthrough chunks of the areas the
// changed files are in (scripts/areas.mjs). "Changed" is everything since
// the last commit, including new files.
//
//   npm run check:changed                 what's changed
//   npm run check:changed -- --ui         …and its walkthrough chunks
//                                         (3 at a time; --jobs 1 for one at a time)
//   npm run check:changed -- people plans those areas, whatever changed
//   npm run check:changed -- --list       what it would run, without running it
//
// `npm run check` and `npm run test:ui` still run everything: do that before
// a release.

import { spawnSync } from "node:child_process";
import { AREAS, planFor, planForAreas } from "./areas.mjs";

const args = process.argv.slice(2);
const withUi = args.includes("--ui");
const listOnly = args.includes("--list");
const jobs = args.includes("--jobs") ? args[args.indexOf("--jobs") + 1] : null;
const names = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--jobs");

/** @param {string[]} gitArgs */
function git(gitArgs) {
  const done = spawnSync("git", gitArgs, { encoding: "utf8" });
  if (done.status !== 0) throw new Error(`git ${gitArgs.join(" ")} failed: ${done.stderr}`);
  return done.stdout.split("\n").filter(Boolean);
}

/** @type {import("./areas.mjs").CheckPlan} */
let plan;
try {
  plan = names.length ? planForAreas(names) : planFor([...new Set([
    ...git(["diff", "--name-only", "HEAD"]),
    ...git(["ls-files", "--others", "--exclude-standard"]),
  ])]);
} catch (err) {
  console.error(/** @type {Error} */ (err).message);
  process.exit(1);
}

const GENERATED = {
  privacy: ["node", "scripts/privacy-html.mjs", "--check"],
  releases: ["node", "scripts/releases.mjs", "--check"],
  welcome: ["node", "scripts/welcome.mjs", "--check"],
  vendor: ["node", "scripts/vendor.mjs", "--check"],
};

/** @type {[string, string[]][]} label, command */
const steps = [
  ["lint", ["npx", "eslint", "."]],
  ["type check", ["npm", "run", "--silent", "typecheck"]],
  ["every test", ["npx", "vitest", "run"]],
];
for (const check of plan.generated) steps.push([`${check} file check`, GENERATED[check]]);
if (withUi && plan.ui.length) steps.push([`walkthrough: ${plan.ui.join(", ")}`, ["node", "scripts/ui-smoke.mjs", "--only", plan.ui.join(","), ...(jobs ? ["--jobs", jobs] : [])]]);

console.log(names.length ? `Areas: ${plan.areas.join(", ")}` : `Changed areas: ${plan.areas.join(", ") || "none"}`);
if (plan.everything.length) console.log(`Everything runs, for: ${plan.everything.join(", ")}`);
if (plan.unmapped.length) {
  console.log(`Not in any area (add them to scripts/areas.mjs): ${plan.unmapped.join(", ")}`);
}
console.log(`Walkthrough chunks: ${plan.ui.join(", ") || "none"}${withUi || !plan.ui.length ? "" : " (add --ui to run them)"}`);
if (listOnly) {
  console.log(`\nWould run: ${steps.map(([label]) => label).join("; ")}`);
  console.log(`Areas: ${AREAS.map((a) => a.name).join(", ")}`);
  process.exit(0);
}

const failed = [];
for (const [label, [command, ...rest]] of steps) {
  console.log(`\n▶ ${label}`);
  const done = spawnSync(command, rest, { stdio: "inherit" });
  if (done.status !== 0) failed.push(label);
}
console.log(failed.length ? `\nFailed: ${failed.join(", ")}` : `\nAll ${steps.length} step(s) passed`);
process.exit(failed.length ? 1 : 0);
