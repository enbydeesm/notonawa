// Builds the app's version and release notes from VERSION (written by
// scripts/deploy.mjs) and RELEASES.md: public/js/releases.js (the page: the
// version shown at the bottom of sign-in and the menu, and the "What's new"
// notes) and src/app-version.js (the Worker: new accounts start as having
// seen the notes up to this version). Notes under "## Next" are left out
// until a deploy names them.
//
//   node scripts/releases.mjs           rebuild them
//   node scripts/releases.mjs --check   fail if they're out of date (npm run check)

import { readFileSync, writeFileSync } from "node:fs";
import { buildReleases } from "./releases-build.mjs";

const PAGE_FILE = new URL("../public/js/releases.js", import.meta.url);
const WORKER_FILE = new URL("../src/app-version.js", import.meta.url);

const { version, releases, page, worker } = buildReleases();
const outputs = [[PAGE_FILE, page], [WORKER_FILE, worker]];

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
    console.error("public/js/releases.js or src/app-version.js is out of date with VERSION and RELEASES.md. Run: node scripts/releases.mjs");
    process.exit(1);
  }
} else {
  for (const [file, text] of outputs) writeFileSync(file, /** @type {string} */ (text));
  console.log(`Version ${version}, ${releases.length} release${releases.length === 1 ? "" : "s"}.`);
}
