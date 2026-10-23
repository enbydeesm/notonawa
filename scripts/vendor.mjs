// Copies the browser libraries the pages use from node_modules into
// public/js/vendor/ (there's no build step), with their type definitions
// beside them for the type checker: mediabunny, which reads and re-encodes
// videos (video-prep.js), and three.js, which draws the poser's figure
// (pose-scene.js). Their versions are pinned in package.json.
//
// three.js is too big to copy whole (about 2 MB, fetched every time the
// poser opens, as nothing is cached): only the parts named in
// scripts/vendor/three-entry.mjs are bundled, minified, by esbuild (which
// comes with wrangler). Its types are ours, in scripts/vendor/three.d.ts,
// covering just those parts.
//
//   node scripts/vendor.mjs           copy them again (after updating a package)
//   node scripts/vendor.mjs --check   fail if a copy differs (npm run check)

import { readFileSync, writeFileSync } from "node:fs";
import { buildSync } from "esbuild";

/**
 * Each file in public/js/vendor/: copied from node_modules (from), maybe
 * edited, or made by make().
 * @type {{ to: string, from?: string, edit?: (text: string) => string, make?: () => string }[]}
 */
const FILES = [
  { from: "mediabunny/dist/bundles/mediabunny.min.mjs", to: "mediabunny.js" },
  // Its references to the WebCodecs type packages are left out: the
  // browser types we check against already have WebCodecs.
  {
    from: "mediabunny/dist/mediabunny.d.ts", to: "mediabunny.d.ts",
    edit: (text) => text.replace(/^\/\/\/ <reference types="[^"]+" \/>\n/gm, ""),
  },
  { to: "three.js", make: bundleThree },
  { to: "three.d.ts", make: () => readFileSync(new URL("./vendor/three.d.ts", import.meta.url), "utf8") },
];

/** The parts of three.js in three-entry.mjs, as one minified module. */
function bundleThree() {
  const result = buildSync({
    entryPoints: [new URL("./vendor/three-entry.mjs", import.meta.url).pathname],
    bundle: true, minify: true, format: "esm", target: "es2022", write: false, legalComments: "inline",
    nodePaths: [new URL("../node_modules", import.meta.url).pathname],
  });
  return result.outputFiles[0].text;
}

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
for (const { from, to, edit = (text) => text, make } of FILES) {
  const target = new URL(`../public/js/vendor/${to}`, import.meta.url);
  const text = make ? make() : edit(readFileSync(new URL(`../node_modules/${from}`, import.meta.url), "utf8"));
  if (!check) writeFileSync(target, text);
  else if (read(target) !== text) {
    console.error(`public/js/vendor/${to} differs from what node_modules makes. Run: node scripts/vendor.mjs`);
    stale++;
  }
}
if (stale) process.exit(1);
