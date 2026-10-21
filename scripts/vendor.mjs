// Copies the browser libraries the pages use from node_modules into
// public/js/vendor/ (there's no build step), with their type definitions
// beside them for the type checker. So far only mediabunny, which reads and
// re-encodes videos (video-prep.js). Its version is pinned in package.json.
//
//   node scripts/vendor.mjs           copy them again (after updating a package)
//   node scripts/vendor.mjs --check   fail if a copy differs (npm run check)

import { readFileSync, writeFileSync } from "node:fs";

const FILES = [
  { from: "mediabunny/dist/bundles/mediabunny.min.mjs", to: "mediabunny.js" },
  // Its references to the WebCodecs type packages are left out: the
  // browser types we check against already have WebCodecs.
  {
    from: "mediabunny/dist/mediabunny.d.ts", to: "mediabunny.d.ts",
    edit: (/** @type {string} */ text) => text.replace(/^\/\/\/ <reference types="[^"]+" \/>\n/gm, ""),
  },
];

/** @param {URL} file */
const read = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

const check = process.argv.includes("--check");
let stale = 0;
for (const { from, to, edit = (/** @type {string} */ text) => text } of FILES) {
  const source = new URL(`../node_modules/${from}`, import.meta.url);
  const target = new URL(`../public/js/vendor/${to}`, import.meta.url);
  const text = edit(readFileSync(source, "utf8"));
  if (!check) writeFileSync(target, text);
  else if (read(target) !== text) {
    console.error(`public/js/vendor/${to} differs from node_modules/${from}. Run: node scripts/vendor.mjs`);
    stale++;
  }
}
if (stale) process.exit(1);
