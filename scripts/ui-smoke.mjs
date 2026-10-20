// UI smoke test: clicks through every page in headless Chrome against a
// throwaway local database, and checks what's on screen.
//
//   npm run test:ui                          every chunk
//   npm run test:ui -- --only people,plans   just those chunks
//   npm run test:ui -- --list                the chunks
//
// It's split into chunks (scripts/ui/chunks/), each starting from a new
// account of its own (and, where it needs one, a journal made by
// scripts/ui/seed.mjs), so any can run alone. scripts/check-changed.mjs
// picks the ones a change needs. A chunk that stops part-way is a failure,
// and the next one still runs.
//
// Needs Google Chrome installed (set CHROME_PATH if it's not in the default
// macOS location). No npm packages: it drives Chrome over the DevTools
// protocol directly (scripts/ui/harness.mjs). Your real local database
// (.wrangler/state) isn't touched.

import { UI_CHUNKS } from "./areas.mjs";

const args = process.argv.slice(2);
if (args.includes("--list")) {
  console.log(UI_CHUNKS.join("\n"));
  process.exit(0);
}
const only = args.includes("--only") ? (args[args.indexOf("--only") + 1] ?? "").split(",").filter(Boolean) : null;
const unknown = (only ?? []).filter((name) => !UI_CHUNKS.includes(name));
if (unknown.length || (only && !only.length)) {
  console.error(`Not a chunk: ${unknown.join(", ") || "(none given)"}. The chunks: ${UI_CHUNKS.join(", ")}.`);
  process.exit(1);
}
const chunks = only ? UI_CHUNKS.filter((name) => only.includes(name)) : UI_CHUNKS;

// Starts the app and Chrome (only once the arguments are known to be good).
const { addFailure, checkConsole, consoleErrors, failureCount, stop } = await import("./ui/harness.mjs");

const started = Date.now();
try {
  for (const name of chunks) {
    const chunkStart = Date.now();
    console.log(`\n=== ${name}`);
    try {
      await (await import(`./ui/chunks/${name}.mjs`)).default();
    } catch (err) {
      addFailure();
      console.error(`  ✗ ${name} stopped part-way:`, err);
    }
    checkConsole();
    consoleErrors.length = 0;
    console.log(`  (${Math.round((Date.now() - chunkStart) / 1000)}s)`);
  }
} finally {
  stop();
}

const failures = failureCount();
const time = `${Math.round((Date.now() - started) / 1000)}s`;
console.log(failures ? `\n${failures} check(s) failed (${time})` : `\nAll UI checks passed: ${chunks.join(", ")} (${time})`);
process.exit(failures ? 1 : 0);
