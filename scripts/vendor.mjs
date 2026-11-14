// Copies the browser libraries the pages use from node_modules into
// public/js/vendor/ (there's no build step), with their type definitions
// beside them for the type checker: mediabunny, which reads and re-encodes
// videos (video-prep.js), three.js, which draws the poser's figure
// (pose-scene.js), uqr, which works out a share link's QR code (qr.js;
// only its encode(), which is pure arithmetic: we draw the squares
// ourselves), and hpke with @panva/hpke-noble, the post-quantum (X-Wing)
// public-key encryption for contacts. Their versions are pinned in
// package.json.
//
// three.js is too big to copy whole (about 2 MB, fetched every time the
// poser opens, as nothing is cached): only the parts named in
// scripts/vendor/three-entry.mjs are bundled, minified, by esbuild (which
// comes with wrangler). Its types are ours, in scripts/vendor/three.d.ts,
// covering just those parts. hpke is bundled the same way, from
// hpke-entry.mjs (with the @noble libraries it uses), typed by hpke.d.ts.
//
//   node scripts/vendor.mjs           copy them again (after updating a package)
//   node scripts/vendor.mjs --check   fail if a copy differs (npm run check)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  { to: "three.js", make: () => bundle("three-entry.mjs") },
  { to: "three.d.ts", make: () => readFileSync(new URL("./vendor/three.d.ts", import.meta.url), "utf8") },
  { from: "uqr/dist/index.mjs", to: "uqr.js" },
  { from: "uqr/dist/index.d.mts", to: "uqr.d.ts" },
  // hpke's and the @noble libraries' own files carry no licence notice
  // (noble-curves and noble-post-quantum do), so the bundle starts with one.
  { to: "hpke.js", make: () => bundle("hpke-entry.mjs", hpkeNotice()) },
  { to: "hpke.d.ts", make: () => readFileSync(new URL("./vendor/hpke.d.ts", import.meta.url), "utf8") },
];

/**
 * The names an entry file in scripts/vendor/ exports, and everything they
 * use, as one minified module, after any banner.
 * @param {string} entry
 * @param {string} [banner]
 */
function bundle(entry, banner) {
  const result = buildSync({
    // fileURLToPath, not .pathname, which keeps spaces as %20.
    entryPoints: [fileURLToPath(new URL(`./vendor/${entry}`, import.meta.url))],
    bundle: true, minify: true, format: "esm", target: "es2022", write: false, legalComments: "inline",
    nodePaths: [fileURLToPath(new URL("../node_modules", import.meta.url))],
    ...(banner ? { banner: { js: banner } } : {}),
  });
  return result.outputFiles[0].text;
}

/** The MIT notices of hpke and the @noble libraries, with their versions. */
function hpkeNotice() {
  /** @param {string} name */
  const version = (name) => JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8")).version;
  const noble = ["hashes", "ciphers", "curves", "post-quantum"].map((p) => `@noble/${p} ${version(`@noble/${p}`)}`);
  return `/*! hpke ${version("hpke")} and @panva/hpke-noble ${version("@panva/hpke-noble")} - MIT License (c) 2025 Filip Skokan */\n`
    + `/*! ${noble.join(", ")} - MIT License (c) Paul Miller (paulmillr.com) */`;
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
