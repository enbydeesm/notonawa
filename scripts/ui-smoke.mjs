// UI smoke test: clicks through every page in headless Chrome against a
// throwaway local database, and checks what's on screen.
//
//   npm run test:ui                          every chunk, 3 at a time
//   npm run test:ui -- --only people,plans   just those chunks
//   npm run test:ui -- --format 2            on format 2 accounts (new sign-ups)
//   npm run test:ui -- --jobs 1              one at a time, output as it happens
//   npm run test:ui -- --list                the chunks
//
// It's split into chunks (scripts/ui/chunks/), each starting from a new
// account of its own (and, where it needs one, a journal made by
// scripts/ui/seed.mjs), so any can run alone. scripts/check-changed.mjs
// picks the ones a change needs. A chunk that stops part-way is a failure,
// and the next one still runs.
//
// With --jobs above 1 (3 by default), the chunks are shared out between
// that many copies of this script (batches() in scripts/areas.mjs), each
// with its own database, app and Chrome on its own ports (UI_SLOT), and
// each chunk's output is shown whole once it's done. A failure seen only
// then may come from the machine being busy: run that chunk with --jobs 1
// to tell.
//
// Needs Google Chrome installed (set CHROME_PATH if it's not in the default
// macOS location). No npm packages: it drives Chrome over the DevTools
// protocol directly (scripts/ui/harness.mjs). Your real local database
// (.wrangler/state) isn't touched.

import { spawn } from "node:child_process";
import readline from "node:readline";
import { UI_CHUNKS, batches } from "./areas.mjs";

const DEFAULT_JOBS = 3;
// What a copy prints after each chunk, for the parent to pick up:
// "@@chunk <name> <seconds> <failed checks> <skipped>".
const MARKER = "@@chunk";

const args = process.argv.slice(2);
if (args.includes("--list")) {
  console.log(UI_CHUNKS.join("\n"));
  process.exit(0);
}
/** @param {string} flag */
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? "" : null);
const only = valueOf("--only")?.split(",").filter(Boolean) ?? null;
const unknown = (only ?? []).filter((name) => !UI_CHUNKS.includes(name));
if (unknown.length || (only && !only.length)) {
  console.error(`Not a chunk: ${unknown.join(", ") || "(none given)"}. The chunks: ${UI_CHUNKS.join(", ")}.`);
  process.exit(1);
}
const jobs = valueOf("--jobs") === null ? DEFAULT_JOBS : Number(valueOf("--jobs"));
if (!Number.isInteger(jobs) || jobs < 1) {
  console.error("--jobs takes a whole number, 1 or more.");
  process.exit(1);
}
const format = valueOf("--format") ?? process.env.UI_FORMAT ?? "1";
if (format !== "1" && format !== "2") {
  console.error("--format takes 1 or 2: the format the walkthrough's new accounts start in.");
  process.exit(1);
}
process.env.UI_FORMAT = format;
const chunks = only ? UI_CHUNKS.filter((name) => only.includes(name)) : UI_CHUNKS;
const report = args.includes("--report");
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;

const runs = batches(chunks, jobs);
// Checks this machine can't run (skip() in scripts/ui/harness.mjs): not failures.
let skipped = 0;
const failures = runs.length > 1 ? await runInParallel(runs) : await runHere(chunks);
const skippedNote = skipped ? ` (${skipped} group(s) of checks skipped on this machine, marked ↷)` : "";
console.log(failures ? `\n${failures} failure(s): failed checks, or runs that stopped (${elapsed()})${skippedNote}`
  : `\nAll UI checks passed${format === "2" ? " on format 2" : ""}: ${chunks.join(", ")} (${elapsed()})${skippedNote}`);
process.exit(failures ? 1 : 0);

/**
 * Runs the chunks one after another in this process, printing as it goes.
 * @param {string[]} names
 * @returns {Promise<number>} failed checks
 */
async function runHere(names) {
  // Starts the app and Chrome (only once the arguments are known to be good).
  const { addFailure, checkConsole, failureCount, skippedCount, stop } = await import("./ui/harness.mjs");
  try {
    for (const name of names) {
      const chunkStart = Date.now(), failedBefore = failureCount(), skippedBefore = skippedCount();
      console.log(`\n=== ${name}`);
      try {
        await (await import(`./ui/chunks/${name}.mjs`)).default();
      } catch (err) {
        addFailure();
        // On stdout when reporting, so it stays with its chunk's lines.
        (report ? console.log : console.error)(`  ✗ ${name} stopped part-way:`, err);
      }
      checkConsole();
      const seconds = Math.round((Date.now() - chunkStart) / 1000);
      console.log(`  (${seconds}s)`);
      if (report) console.log(`${MARKER} ${name} ${seconds} ${failureCount() - failedBefore} ${skippedCount() - skippedBefore}`);
    }
  } finally {
    await stop();
  }
  // A copy reporting to its parent counts its skips there, in the marker.
  if (!report) skipped += skippedCount();
  return failureCount();
}

/**
 * Runs each batch in its own copy of this script, at the same time, and
 * shows each chunk's output whole when it's done.
 * @param {string[][]} batchList
 * @returns {Promise<number>} failed checks
 */
async function runInParallel(batchList) {
  console.log(`Running ${chunks.length} chunks in ${batchList.length} parallel runs:`);
  batchList.forEach((batch, i) => console.log(`  ${i + 1}. ${batch.join(", ")}`));
  let done = 0, failed = 0;
  /** @type {string[]} */ const failedChunks = [];

  const results = await Promise.all(batchList.map((batch, slot) => new Promise((resolve) => {
    const child = spawn(process.execPath, [import.meta.filename, "--only", batch.join(","), "--jobs", "1", "--report"], {
      env: { ...process.env, UI_SLOT: String(slot) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    /** @type {string[]} */ let lines = [];
    let failedInRun = 0;
    const onLine = (/** @type {string} */ line) => {
      if (!line.startsWith(MARKER)) {
        lines.push(line);
        return;
      }
      const [, name, seconds, failedHere, skippedHere] = line.split(" ");
      done++;
      skipped += Number(skippedHere ?? 0);
      failed += Number(failedHere);
      failedInRun += Number(failedHere);
      if (Number(failedHere)) failedChunks.push(name);
      // The chunk's own lines, without the copy's blank line before it.
      console.log(`\n${lines.join("\n").trim()}`);
      const skipNote = Number(skippedHere) ? `, ${skippedHere} skipped here` : "";
      console.log(`${Number(failedHere) ? "✗" : "✓"} ${name} ${seconds}s${skipNote} (${done}/${chunks.length} done, ${elapsed()})`);
      lines = [];
    };
    readline.createInterface({ input: child.stdout }).on("line", onLine);
    readline.createInterface({ input: child.stderr }).on("line", onLine);
    child.on("close", (code) => {
      // Whatever came after the last chunk: its summary, or why it stopped.
      const rest = lines.filter((l) => l.trim() && !/^All UI checks passed|check\(s\) failed/.test(l));
      if (code !== 0 && rest.length) console.log(`\nRun ${slot + 1} (${batch.join(", ")}):\n${rest.join("\n")}`);
      // A copy that failed without a failed check (it couldn't start, or
      // crashed) still counts as one.
      resolve(code !== 0 && !failedInRun ? 1 : 0);
    });
  })));

  const crashed = results.reduce((sum, n) => sum + n, 0);
  if (failedChunks.length) console.log(`\nFailed chunks: ${failedChunks.join(", ")} (run one alone: npm run test:ui -- --only <chunk> --jobs 1)`);
  return failed + crashed;
}
