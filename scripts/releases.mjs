// Builds the app's version and release notes from RELEASES.md:
// public/js/releases.js (the page: the version shown at the bottom of
// sign-in and the menu, and the "What's new" notes) and src/app-version.js
// (the Worker: new accounts start as having seen this version's notes).
//
//   node scripts/releases.mjs           rebuild them
//   node scripts/releases.mjs --check   fail if they're out of date (npm run check)
//
// Add a release at the top of RELEASES.md before deploying, then rebuild.

import { readFileSync, writeFileSync } from "node:fs";
import { parseReleases, pageFile, workerFile } from "./releases-lib.mjs";

const SOURCE = new URL("../RELEASES.md", import.meta.url);
const PAGE_FILE = new URL("../public/js/releases.js", import.meta.url);
const WORKER_FILE = new URL("../src/app-version.js", import.meta.url);

const releases = parseReleases(readFileSync(SOURCE, "utf8"));
const outputs = [[PAGE_FILE, pageFile(releases)], [WORKER_FILE, workerFile(releases)]];

/** @param {URL} file */
const read = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

if (process.argv.includes("--check")) {
  if (outputs.some(([file, text]) => read(/** @type {URL} */ (file)) !== text)) {
    console.error("public/js/releases.js or src/app-version.js is out of date with RELEASES.md. Run: node scripts/releases.mjs");
    process.exit(1);
  }
} else {
  for (const [file, text] of outputs) writeFileSync(file, /** @type {string} */ (text));
  console.log(`Version ${releases[0].version}, ${releases.length} release${releases.length === 1 ? "" : "s"}.`);
}
